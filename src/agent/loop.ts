import { addUsage, emptyUsage, textOf, toolCallsOf, type ContentBlock, type Message, type StreamEvent, type ToolCallBlock, type Usage } from "../core/types.ts";
import { ProviderError, type Provider } from "../providers/provider.ts";
import { addCost, costOf, type Pricing } from "../telemetry/pricing.ts";
import type { ToolRegistry, PermissionMode } from "../tools/index.ts";
import type { ApprovalFn, ToolContext } from "../tools/types.ts";
import { RepetitionGuard } from "./repetition.ts";
import { recoverToolCalls, textProtocolInstructions, toTextProtocol } from "./toolcall-parser.ts";
import { COMPACTION_PROMPT, elideOldToolResults, estimateTokens, renderTranscript, safeCutIndex, stripThinking } from "./context.ts";
import type { AgentEvent, AgentEventHandler, RunOutcome, RunSummary } from "./events.ts";

export interface AgentOptions {
  provider: Provider;
  model: string;
  system: string;
  tools: ToolRegistry;
  toolContext: ToolContext;
  mode: PermissionMode;
  approve?: ApprovalFn;
  maxTurns: number;
  maxTokens: number;
  reasoning?: "off" | "low" | "medium" | "high" | "max";
  temperature?: number;
  sampling?: { topP?: number; topK?: number; minP?: number };
  templateKwargs?: Record<string, unknown>;
  contextWindow?: number;
  maxOutputTokens?: number; // model's hard output cap, from the models registry
  compactTools?: boolean; // offer only core tools (small context windows)
  // "native": structured tool calls; "text": tools described in the prompt and parsed
  // from text, for models/runtimes without native tool calling.
  toolProtocol?: "native" | "text";
  // Recover tool calls written as text when a native call was expected (default on).
  parseTextToolCalls?: boolean;
  // Loop guard, empty-turn nudges and dropped-tool-call fallback (default on).
  recoveries?: boolean;
  contextBudgetRatio?: number;
  pricing?: Pricing;
  budgetUsd?: number;
  maxRetries?: number;
  onEvent?: AgentEventHandler;
  signal?: AbortSignal;
  runId?: string;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });

class LoopDetected extends Error {}

export const newRunId = () => `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// The core agent loop: stream a model turn, execute requested tools, feed results
// back, repeat until the model ends its turn, a limit is hit, or the run is aborted.
// History is append-only except during compaction.
export class Agent {
  readonly sessionId: string;
  runId: string;
  messages: Message[] = [];
  private usage: Usage = emptyUsage();
  private cost: number | null = null;
  private turn = 0;
  private toolCalls = 0;
  private toolErrors = 0;
  private firstTtft: number | null = null;
  private changed = new Set<string>();

  constructor(private o: AgentOptions) {
    this.runId = o.runId ?? newRunId();
    this.sessionId = this.runId.replace(/^run_/, "ses_");
  }

  private runCount = 0;
  private loopRecoveries = 0;
  // Set when the server drops native tool calls; persists for the session.
  private textProtocolFallback = false;

  private emit(e: AgentEvent) {
    this.o.onEvent?.(e);
  }

  // Runs one user request to completion. Can be called repeatedly for multi-turn chat.
  async run(prompt: string | ContentBlock[]): Promise<RunSummary> {
    const start = performance.now();
    // Each call is its own run (own id and counters); the session keeps the history.
    if (this.runCount++ > 0) this.runId = newRunId();
    this.usage = emptyUsage();
    this.cost = null;
    this.toolCalls = 0;
    this.toolErrors = 0;
    this.firstTtft = null;
    this.changed = new Set();
    const content: ContentBlock[] = typeof prompt === "string" ? [{ type: "text", text: prompt }] : prompt;
    this.messages.push({ role: "user", content });
    this.emit({ type: "run_start", runId: this.runId, sessionId: this.sessionId, model: this.o.model, provider: this.o.provider.key, prompt: textOf({ role: "user", content }), t: Date.now() });
    const startTurn = this.turn;
    let outcome: RunOutcome = "completed";
    let error: string | undefined;
    let finalText = "";
    let maxTokens = this.o.maxTokens;
    let jsonRetries = 0;
    let truncationRetries = 0;
    let overflowRetried = false;
    let nudges = 0;

    try {
      while (true) {
        if (this.o.signal?.aborted) throw new Error("aborted");
        if (this.turn - startTurn >= this.o.maxTurns) {
          outcome = "max_turns";
          break;
        }
        if (this.o.budgetUsd !== undefined && (this.cost ?? 0) >= this.o.budgetUsd) {
          outcome = "budget";
          break;
        }
        await this.maybeCompact(this.truncated);
        this.truncated = false;
        this.turn++;
        this.emit({ type: "turn_start", runId: this.runId, turn: this.turn, contextTokens: estimateTokens(this.messages, this.o.system), t: Date.now() });

        let res;
        try {
          res = await this.callModel(maxTokens);
          jsonRetries = 0;
        } catch (err) {
          // The real context limit was hit: force summarisation and retry the turn once.
          if (err instanceof ProviderError && err.code === "context_overflow" && !overflowRetried) {
            overflowRetried = true;
            this.turn--;
            await this.maybeCompact(true);
            continue;
          }
          if (err instanceof ProviderError && err.code === "invalid_tool_json" && jsonRetries++ < 2) {
            this.emit({ type: "retry", runId: this.runId, turn: this.turn, attempt: jsonRetries, reason: "invalid tool JSON", delayMs: 0, t: Date.now() });
            this.turn--;
            continue;
          }
          throw err;
        }
        const calls = toolCallsOf(res.message);
        if (res.stopReason === "refusal") {
          this.messages.push(res.message);
          finalText = textOf(res.message);
          outcome = "refusal";
          break;
        }
        // A tool input cut off at max_tokens can parse as a valid partial object:
        // never run it. Retry the turn once with a doubled output budget.
        if (res.stopReason === "max_tokens" && calls.length) {
          if (truncationRetries++ < 1 && maxTokens < (this.o.maxOutputTokens ?? Number.POSITIVE_INFINITY)) {
            maxTokens = Math.min(maxTokens * 2, this.o.maxOutputTokens ?? maxTokens * 2);
            this.emit({ type: "retry", runId: this.runId, turn: this.turn, attempt: truncationRetries, reason: "tool input truncated at max_tokens", delayMs: 0, t: Date.now() });
            this.turn--;
            continue;
          }
          outcome = "max_tokens";
          break;
        }
        this.messages.push(res.message);
        // A turn with neither an answer nor a tool call (e.g. a reasoning model that spent
        // the turn thinking) is not a finished task: nudge the model to continue.
        if (!calls.length && !textOf(res.message).trim() && res.stopReason !== "max_tokens" && nudges < 2 && this.o.recoveries !== false) {
          nudges++;
          this.emit({ type: "retry", runId: this.runId, turn: this.turn, attempt: nudges, reason: "turn ended without an answer or tool call", delayMs: 0, t: Date.now() });
          this.messages.push({ role: "user", content: [{ type: "text", text: "You ended your turn without a tool call or a reply. Continue the task: use the tools to make the change and verify it, then reply with a short summary." }] });
          continue;
        }
        if (!calls.length) {
          finalText = textOf(res.message);
          if (res.stopReason === "max_tokens") outcome = "max_tokens";
          break;
        }
        const results = await this.runTools(calls);
        this.messages.push({ role: "user", content: results });
      }
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      outcome = this.o.signal?.aborted || msg === "aborted" ? "aborted" : "error";
      error = msg;
      this.emit({ type: "error", runId: this.runId, turn: this.turn, message: msg, t: Date.now() });
    }

    const summary: RunSummary = {
      runId: this.runId,
      outcome,
      finalText,
      turns: this.turn - startTurn,
      toolCalls: this.toolCalls,
      toolErrors: this.toolErrors,
      usage: this.usage,
      costUsd: this.cost,
      wallMs: performance.now() - start,
      ttftMs: this.firstTtft,
      changedFiles: [...this.changed].sort(),
      ...(error ? { error } : {}),
    };
    this.emit({ type: "run_end", runId: this.runId, result: summary, t: Date.now() });
    return summary;
  }

  // One model call with retry/backoff on transient provider errors.
  private async callModel(maxTokens: number) {
    const maxRetries = this.o.maxRetries ?? 3;
    for (let attempt = 1; ; attempt++) {
      this.emit({ type: "model_request", runId: this.runId, turn: this.turn, attempt, t: Date.now() });
      const t0 = performance.now();
      let ttft: number | null = null;
      // Per-request abort so a looping generation can be cut without ending the run.
      const req = new AbortController();
      const onAbort = () => req.abort();
      this.o.signal?.addEventListener("abort", onAbort);
      const guard = this.o.recoveries === false ? null : new RepetitionGuard();
      let looped = false;
      try {
        const specs = this.o.tools.specs(this.o.mode, this.o.toolContext, this.o.compactTools);
        const textMode = this.o.toolProtocol === "text" || this.textProtocolFallback;
        const stream = this.o.provider.stream({
          model: this.o.model,
          system: textMode ? `${this.o.system}\n\n${textProtocolInstructions(specs)}` : this.o.system,
          messages: textMode ? toTextProtocol(this.messages) : this.messages,
          tools: textMode ? [] : specs,
          maxTokens,
          reasoning: this.o.reasoning,
          temperature: this.o.temperature,
          ...this.o.sampling,
          templateKwargs: this.o.templateKwargs,
          contextWindow: this.o.contextWindow,
          signal: req.signal,
        });
        let done: Extract<StreamEvent, { type: "done" }> | undefined;
        for await (const ev of stream) {
          if (ttft === null && (ev.type === "text_delta" || ev.type === "tool_call_start" || ev.type === "thinking_delta")) {
            ttft = performance.now() - t0;
            this.firstTtft ??= ttft;
            this.emit({ type: "first_token", runId: this.runId, turn: this.turn, ttftMs: ttft, t: Date.now() });
          }
          if (ev.type === "text_delta") this.emit({ type: "text_delta", runId: this.runId, turn: this.turn, text: ev.text });
          else if (ev.type === "thinking_delta") this.emit({ type: "thinking_delta", runId: this.runId, turn: this.turn, text: ev.text });
          if ((ev.type === "text_delta" || ev.type === "thinking_delta" || ev.type === "tool_call_delta") && guard?.push(ev.type === "tool_call_delta" ? ev.partialJson : ev.text)) {
            looped = true;
            req.abort();
            break;
          }
          else if (ev.type === "done") done = ev;
        }
        if (looped) throw new LoopDetected();
        if (!done) throw new Error("provider stream ended without a done event");
        // The server said it produced tool calls but delivered none (its tool-call parser
        // failed on this model's format). Switch this session to the text protocol, where
        // ah parses calls itself, and retry the turn.
        if (this.o.recoveries !== false && !textMode && done.stopReason === "tool_use" && !toolCallsOf(done.message).length && !textOf(done.message).trim()) {
          this.textProtocolFallback = true;
          this.emit({ type: "retry", runId: this.runId, turn: this.turn, attempt, reason: "server reported tool calls but sent none; switching to text tool protocol", delayMs: 0, t: Date.now() });
          continue;
        }
        // A response with no content and no tokens is a server failure, not an answer.
        if (!done.message.content.length && !done.usage.outputTokens && done.stopReason !== "refusal")
          throw new ProviderError(`${this.o.provider.key}: empty response from the model server`, this.o.provider.key, 502, true);
        if (textMode || this.o.parseTextToolCalls !== false) {
          const recovered = recoverToolCalls(done.message, specs.map((s) => s.name), `txt_${this.runId.slice(-6)}_${this.turn}_${attempt}`);
          if (recovered) {
            done = { ...done, message: recovered.message, stopReason: done.stopReason === "max_tokens" ? "max_tokens" : "tool_use" };
            this.emit({ type: "tool_calls_recovered", runId: this.runId, turn: this.turn, count: toolCallsOf(recovered.message).length, formats: recovered.formats, t: Date.now() });
          }
        }
        const latencyMs = performance.now() - t0;
        const cost = costOf(done.usage, this.o.pricing);
        this.usage = addUsage(this.usage, done.usage);
        this.cost = addCost(this.cost, cost);
        const genMs = ttft === null ? latencyMs : latencyMs - ttft;
        this.emit({
          type: "model_response",
          runId: this.runId,
          turn: this.turn,
          stopReason: done.stopReason,
          usage: done.usage,
          costUsd: cost,
          latencyMs,
          ttftMs: ttft,
          outputTokensPerSec: genMs > 0 && done.usage.outputTokens ? (done.usage.outputTokens / genMs) * 1000 : null,
          toolCalls: toolCallsOf(done.message).length,
          timings: done.timings,
          t: Date.now(),
        });
        this.checkTruncation(done.usage.inputTokens);
        return { message: done.message, stopReason: done.stopReason };
      } catch (err) {
        if (this.o.signal?.aborted) throw new Error("aborted");
        if (err instanceof LoopDetected || looped) {
          // Tell the model what happened and let it try the turn again (at most twice).
          if (this.loopRecoveries++ >= 2) throw new Error("model output kept looping");
          this.emit({ type: "retry", runId: this.runId, turn: this.turn, attempt, reason: "repetitive output detected; request cut and retried", delayMs: 0, t: Date.now() });
          const note = { type: "text" as const, text: "[ah] Your previous reply started repeating itself and was cut off. Do not repeat; take the next concrete step with a tool, or give the final answer." };
          const last = this.messages.at(-1);
          // Attach to the pending user turn to keep roles alternating.
          if (last?.role === "user") this.messages[this.messages.length - 1] = { ...last, content: [...last.content, note] };
          else this.messages.push({ role: "user", content: [note] });
          continue;
        }
        const retryable = err instanceof ProviderError && err.retryable && err.code !== "invalid_tool_json";
        if (!retryable || attempt > maxRetries) throw err;
        const delayMs = Math.min(30_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
        this.emit({ type: "retry", runId: this.runId, turn: this.turn, attempt, reason: (err as Error).message.slice(0, 200), delayMs, t: Date.now() });
        await sleep(delayMs, this.o.signal);
      } finally {
        this.o.signal?.removeEventListener("abort", onAbort);
      }
    }
  }

  // Local runtimes can drop the start of an over-long prompt without an error. When the
  // runtime saw far fewer tokens than we sent and sat at the window edge, flag it and
  // compact before the next turn.
  private truncated = false;
  private checkTruncation(reported: number) {
    const window = this.o.contextWindow;
    if (!window || !reported) return;
    const estimate = estimateTokens(this.messages, this.o.system);
    if (reported >= window * 0.9 && estimate > reported * 1.3) {
      this.truncated = true;
      this.emit({ type: "context_truncated", runId: this.runId, turn: this.turn, reportedTokens: reported, estimatedTokens: estimate, window, t: Date.now() });
    }
  }

  private async runOneTool(c: ToolCallBlock): Promise<ContentBlock[]> {
    const tool = this.o.tools.get(c.name);
    const summary = tool?.summarize?.(c.input) ?? c.name;
    this.emit({ type: "tool_start", runId: this.runId, turn: this.turn, id: c.id, name: c.name, input: c.input, summary, t: Date.now() });
    const out = await this.o.tools.execute(c.name, c.input, this.o.toolContext, this.o.mode, this.o.approve);
    this.toolCalls++;
    if (out.isError) this.toolErrors++;
    out.changedFiles?.forEach((f) => this.changed.add(f));
    this.emit({
      type: "tool_end",
      runId: this.runId,
      turn: this.turn,
      id: c.id,
      name: c.name,
      durationMs: out.durationMs,
      isError: Boolean(out.isError),
      denied: Boolean(out.denied),
      outputChars: out.content.length,
      changedFiles: out.changedFiles ?? [],
      preview: out.content.slice(0, 300),
      t: Date.now(),
    });
    const blocks: ContentBlock[] = [{ type: "tool_result", toolCallId: c.id, content: out.content, isError: out.isError }];
    // Images (read_file on a png, generate_image) go back to the model as content.
    for (const img of out.images ?? []) blocks.push(img);
    return blocks;
  }

  // Read-only calls in the same turn run concurrently; any write forces sequential order.
  private async runTools(calls: ToolCallBlock[]): Promise<ContentBlock[]> {
    const allReadOnly = calls.every((c) => this.o.tools.get(c.name)?.readOnly);
    const results = allReadOnly
      ? await Promise.all(calls.map((c) => this.runOneTool(c)))
      : await calls.reduce<Promise<ContentBlock[][]>>(async (acc, c) => [...(await acc), await this.runOneTool(c)], Promise.resolve([]));
    // Tool results first (provider requirement), then any images.
    const flat = results.flat();
    return [...flat.filter((b) => b.type === "tool_result"), ...flat.filter((b) => b.type !== "tool_result")];
  }

  // Keeps the context under budget: first elide old tool output, then summarise.
  private async maybeCompact(force: boolean) {
    const window = this.o.contextWindow;
    if (!window && !force) return;
    const budget = (window ?? 0) * (this.o.contextBudgetRatio ?? 0.8);
    const before = estimateTokens(this.messages, this.o.system);
    if (!force && before <= budget) return;
    const elided = elideOldToolResults(this.messages);
    const afterElide = estimateTokens(elided, this.o.system);
    if (!force && afterElide <= budget * 0.9) {
      this.messages = stripThinking(elided);
      this.emit({ type: "compaction", runId: this.runId, turn: this.turn, beforeTokens: before, afterTokens: afterElide, strategy: "elide", t: Date.now() });
      return;
    }
    const cut = safeCutIndex(this.messages, force ? 2 : 6);
    if (cut <= 0) return;
    const head = this.messages.slice(0, cut);
    const tail = this.messages.slice(cut);
    const res = await this.o.provider.stream({
      model: this.o.model,
      system: "You compress coding-agent transcripts into faithful working notes.",
      messages: [{ role: "user", content: [{ type: "text", text: `${COMPACTION_PROMPT}\n\n<transcript>\n${renderTranscript(head)}\n</transcript>` }] }],
      tools: [],
      maxTokens: 4096,
      signal: this.o.signal,
    });
    let summary = "";
    for await (const ev of res) {
      if (ev.type === "done") {
        summary = textOf(ev.message);
        this.usage = addUsage(this.usage, ev.usage);
        this.cost = addCost(this.cost, costOf(ev.usage, this.o.pricing));
      }
    }
    this.messages = stripThinking([
      { role: "user", content: [{ type: "text", text: `[Earlier conversation compacted]\n${summary}` }] },
      { role: "assistant", content: [{ type: "text", text: "Understood. Continuing from these notes." }] },
      ...tail,
    ]);
    const after = estimateTokens(this.messages, this.o.system);
    this.emit({ type: "compaction", runId: this.runId, turn: this.turn, beforeTokens: before, afterTokens: after, strategy: "summarize", t: Date.now() });
  }
}
