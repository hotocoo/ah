import { addUsage, emptyUsage, textOf, toolCallsOf, type ContentBlock, type Message, type StreamEvent, type ToolCallBlock, type Usage } from "../core/types.ts";
import { ProviderError, type Provider } from "../providers/provider.ts";
import { addCost, costOf, type Pricing } from "../telemetry/pricing.ts";
import type { ToolRegistry, PermissionMode } from "../tools/index.ts";
import type { ApprovalFn, ToolContext } from "../tools/types.ts";
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
  contextWindow?: number;
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

export const newRunId = () => `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// The core agent loop: stream a model turn, execute requested tools, feed results
// back, repeat until the model ends its turn, a limit is hit, or the run is aborted.
// History is append-only except during compaction.
export class Agent {
  readonly runId: string;
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
  }

  private emit(e: AgentEvent) {
    this.o.onEvent?.(e);
  }

  // Runs one user request to completion. Can be called repeatedly for multi-turn chat.
  async run(prompt: string | ContentBlock[]): Promise<RunSummary> {
    const start = performance.now();
    const content: ContentBlock[] = typeof prompt === "string" ? [{ type: "text", text: prompt }] : prompt;
    this.messages.push({ role: "user", content });
    this.emit({ type: "run_start", runId: this.runId, model: this.o.model, provider: this.o.provider.key, prompt: textOf({ role: "user", content }), t: Date.now() });
    const startTurn = this.turn;
    let outcome: RunOutcome = "completed";
    let error: string | undefined;
    let finalText = "";
    let maxTokens = this.o.maxTokens;
    let jsonRetries = 0;
    let truncationRetries = 0;

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
        await this.maybeCompact();
        this.turn++;
        this.emit({ type: "turn_start", runId: this.runId, turn: this.turn, contextTokens: estimateTokens(this.messages, this.o.system), t: Date.now() });

        let res;
        try {
          res = await this.callModel(maxTokens);
          jsonRetries = 0;
        } catch (err) {
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
          if (truncationRetries++ < 1) {
            maxTokens = maxTokens * 2;
            this.emit({ type: "retry", runId: this.runId, turn: this.turn, attempt: truncationRetries, reason: "tool input truncated at max_tokens", delayMs: 0, t: Date.now() });
            this.turn--;
            continue;
          }
          outcome = "max_tokens";
          break;
        }
        this.messages.push(res.message);
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
      try {
        const stream = this.o.provider.stream({
          model: this.o.model,
          system: this.o.system,
          messages: this.messages,
          tools: this.o.tools.specs(this.o.mode),
          maxTokens,
          reasoning: this.o.reasoning,
          temperature: this.o.temperature,
          signal: this.o.signal,
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
          else if (ev.type === "done") done = ev;
        }
        if (!done) throw new Error("provider stream ended without a done event");
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
          t: Date.now(),
        });
        return { message: done.message, stopReason: done.stopReason };
      } catch (err) {
        if (this.o.signal?.aborted) throw new Error("aborted");
        const retryable = err instanceof ProviderError && err.retryable && err.code !== "invalid_tool_json";
        if (!retryable || attempt > maxRetries) throw err;
        const delayMs = Math.min(30_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
        this.emit({ type: "retry", runId: this.runId, turn: this.turn, attempt, reason: (err as Error).message.slice(0, 200), delayMs, t: Date.now() });
        await sleep(delayMs, this.o.signal);
      }
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
  private async maybeCompact() {
    const window = this.o.contextWindow;
    if (!window) return;
    const budget = window * (this.o.contextBudgetRatio ?? 0.8);
    const before = estimateTokens(this.messages, this.o.system);
    if (before <= budget) return;
    const elided = elideOldToolResults(this.messages);
    const afterElide = estimateTokens(elided, this.o.system);
    if (afterElide <= budget * 0.9) {
      this.messages = stripThinking(elided);
      this.emit({ type: "compaction", runId: this.runId, turn: this.turn, beforeTokens: before, afterTokens: afterElide, strategy: "elide", t: Date.now() });
      return;
    }
    const cut = safeCutIndex(this.messages, 6);
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
