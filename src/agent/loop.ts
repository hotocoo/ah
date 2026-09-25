import { addUsage, emptyUsage, textOf, toolCallsOf, type ContentBlock, type Message, type StreamEvent, type ToolCallBlock, type Usage } from "../core/types.ts";
import { ProviderError, type Provider } from "../providers/provider.ts";
import { addCost, costOf, type Pricing } from "../telemetry/pricing.ts";
import type { ToolRegistry, PermissionMode } from "../tools/index.ts";
import type { ApprovalFn, ToolContext } from "../tools/types.ts";
import { RepetitionGuard } from "./repetition.ts";
import { recoverToolCalls, textProtocolInstructions, toTextProtocol } from "./toolcall-parser.ts";
import { COMPACTION_PROMPT, elideOldToolResults, estimateTokens, renderTranscript, safeCutIndex, stripThinking } from "./context.ts";
import type { AgentEvent, AgentEventHandler, RunOutcome, RunSummary } from "./events.ts";
import { mentionedFiles } from "./mentions.ts";
import { EvidenceLedger } from "./evidence.ts";
import type { MemoryStore } from "../memory/store.ts";

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
  params?: Record<string, unknown>;
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
  // Completion gate: a run that changed files is asked once to pass a check before it
  // may end (default on). testCommand is the project's detected test command.
  evidenceGate?: boolean;
  testCommand?: string | null;
  // Persistent memory: recalled into each request, written from verified lessons,
  // reinforced by run verdicts. scopes[0] is where new memories are written.
  memory?: { store: MemoryStore; scopes: string[]; recallLimit?: number };
  // Episodic reset: after this many consecutive failed actions, rebuild the context from
  // the task and harness evidence (D31). 0 disables.
  resetAfterFailures?: number;
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

  // Approvals go wherever the current caller listens (the web app has one stream per run).
  setApprover(fn: AgentOptions["approve"]) {
    this.o.approve = fn;
  }

  // Reasoning effort, sampling and output cap can change between runs of a session.
  setGeneration(g: { reasoning?: AgentOptions["reasoning"]; temperature?: number; topP?: number; topK?: number; maxTokens?: number; templateKwargs?: Record<string, unknown> }) {
    if (g.reasoning) this.o.reasoning = g.reasoning;
    if (g.temperature !== undefined) this.o.temperature = g.temperature;
    if (g.topP !== undefined || g.topK !== undefined) this.o.sampling = { ...this.o.sampling, ...(g.topP !== undefined ? { topP: g.topP } : {}), ...(g.topK !== undefined ? { topK: g.topK } : {}) };
    if (g.maxTokens) this.o.maxTokens = Math.min(g.maxTokens, this.o.maxOutputTokens ?? g.maxTokens);
    if (g.templateKwargs) this.o.templateKwargs = { ...this.o.templateKwargs, ...g.templateKwargs };
  }

  setMode(mode: PermissionMode) {
    this.o.mode = mode;
  }

  // Same for cancellation: each run can have its own signal (stop button, Ctrl-C).
  setSignal(signal: AbortSignal | undefined) {
    this.o.signal = signal;
    this.o.toolContext.signal = signal;
  }

  // Steering: a message typed while the agent works. It joins the transcript before the
  // next model request instead of waiting for the run to end.
  private steering: string[] = [];
  steer(text: string) {
    this.steering.push(text);
  }
  private drainSteering() {
    if (!this.steering.length) return;
    const text = this.steering.splice(0).join("\n\n");
    this.task += `\n\nUser update during the run: ${text}`;
    const block: ContentBlock = { type: "text", text: `[User message while you were working] ${text}` };
    const last = this.messages.at(-1);
    // Keep roles alternating: fold into a trailing user message (tool results) if there is one.
    if (last?.role === "user") this.messages[this.messages.length - 1] = { ...last, content: [...last.content, block] };
    else this.messages.push({ role: "user", content: [block] });
    this.emit({ type: "steer", runId: this.runId, turn: this.turn, text, t: Date.now() });
  }

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
    this.ledger = new EvidenceLedger(this.o.testCommand ?? null);
    const content: ContentBlock[] = typeof prompt === "string" ? [{ type: "text", text: prompt }] : prompt;
    const promptText = textOf({ role: "user", content });
    this.task = promptText;
    this.emit({ type: "run_start", runId: this.runId, sessionId: this.sessionId, model: this.o.model, provider: this.o.provider.key, prompt: promptText, t: Date.now() });
    // Recalled memory rides on the user message, not the system prompt, so the cached
    // system prefix stays byte-stable (D4).
    const recalled = this.recall(promptText);
    const attached = mentionedFiles(this.o.toolContext.root, promptText);
    for (const a of attached) this.o.toolContext.readFiles.add(a.abs);
    if (attached.length) this.emit({ type: "attachments", runId: this.runId, turn: this.turn, files: attached.map((a) => a.path), t: Date.now() });
    // Say plainly that these count as read, or models spend a turn re-reading them.
    const files: ContentBlock[] = attached.length ? [{ type: "text", text: `The user attached ${attached.map((a) => a.path).join(", ")} (current content below, with line numbers as read_file shows them). These files are already read in this session: edit them directly without calling read_file.\n\n${attached.map((a) => `<file path="${a.path}">\n${a.text}\n</file>`).join("\n\n")}` }] : [];
    this.messages.push({ role: "user", content: [...(recalled.block ? [recalled.block] : []), ...content, ...files] });
    const startTurn = this.turn;
    let outcome: RunOutcome = "completed";
    let error: string | undefined;
    let finalText = "";
    let maxTokens = this.o.maxTokens;
    let jsonRetries = 0;
    let truncationRetries = 0;
    let overflowRetried = false;
    let nudges = 0;
    let gated = false;
    let cutoffs = 0;

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
        // A streak of failed actions usually means the model is circling inside its own
        // transcript. Start a fresh episode from the task and the evidence instead.
        const streakLimit = this.o.resetAfterFailures ?? 0;
        const reset = streakLimit > 0 && this.ledger.failureStreak >= streakLimit;
        if (reset) {
          this.emit({ type: "retry", runId: this.runId, turn: this.turn, attempt: 1, reason: `${this.ledger.failureStreak} failed actions in a row; context rebuilt from task and evidence`, delayMs: 0, t: Date.now() });
          this.ledger.failureStreak = 0;
        }
        this.drainSteering();
        await this.maybeCompact(this.truncated || reset);
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
        // A tool input cut off at max_tokens can parse as a valid partial object: never run it.
        // Regenerating the same huge call with a bigger budget repeats minutes of decoding on
        // a local model and often truncates again, so record the cut-off and ask for the same
        // work in smaller pieces. (Without recoveries: retry once with a doubled budget.)
        if (res.stopReason === "max_tokens" && calls.length && this.o.recoveries !== false) {
          if (truncationRetries++ < 2) {
            const name = calls.at(-1)!.name;
            this.emit({ type: "retry", runId: this.runId, turn: this.turn, attempt: truncationRetries, reason: `${name} input cut off at the output limit; asked to split the work`, delayMs: 0, t: Date.now() });
            this.messages.push({ role: "assistant", content: [{ type: "text", text: textOf(res.message).trim() || `(reply cut off at the output limit while writing a ${name} call)` }] });
            this.messages.push({ role: "user", content: [{ type: "text", text: `[ah] Your last reply hit the output limit (${maxTokens} tokens) while writing a ${name} call. The call was cut off and discarded: nothing ran and no file changed. Do the same work in smaller steps: split large content across several files or successive calls, each well under the limit, and keep reasoning short.` }] });
            continue;
          }
          outcome = "max_tokens";
          break;
        }
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
        // Evidence gate: the model wants to finish, but files changed and no check has
        // passed since. Ask once; the verdict records what happened either way.
        const debt = !calls.length && res.stopReason !== "max_tokens" && this.o.evidenceGate !== false && !gated ? this.ledger.unverified() : null;
        if (debt) {
          gated = true;
          this.emit({ type: "evidence_gate", runId: this.runId, turn: this.turn, files: debt.files, lastFailed: debt.lastFailed, t: Date.now() });
          const how = this.o.testCommand ? `\`${this.o.testCommand}\` (run_tests) or the build/type check` : "the project's tests, build or type check";
          const text = debt.lastFailed
            ? `[ah] The last check failed and ${debt.files.join(", ")} changed without a passing check since. Fix the failure and re-run ${how}. If it cannot pass, say exactly why in your final reply.`
            : `[ah] You changed ${debt.files.join(", ")} but no check has passed since. Run ${how} now and fix any failure. If no check applies, say so explicitly in your final reply.`;
          this.messages.push({ role: "user", content: [{ type: "text", text }] });
          continue;
        }
        // A reply cut off at the output cap with no tool call (typically a reasoning model
        // that thought until the limit) is not an answer: ask for a short next step.
        if (!calls.length && res.stopReason === "max_tokens" && cutoffs < 2 && this.o.recoveries !== false) {
          cutoffs++;
          this.emit({ type: "retry", runId: this.runId, turn: this.turn, attempt: cutoffs, reason: "reply hit the output limit without a tool call", delayMs: 0, t: Date.now() });
          this.messages.push({ role: "user", content: [{ type: "text", text: "[ah] Your reply was cut off at the output limit. Think less per turn: take the next concrete step with a tool now (write or run code), then continue." }] });
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

    const verdict = this.ledger.verdict(outcome === "completed");
    this.settleMemory(verdict, recalled.ids);
    const summary: RunSummary = {
      verdict,
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
          params: this.o.params,
          contextWindow: this.o.contextWindow,
          signal: req.signal,
        });
        let done: Extract<StreamEvent, { type: "done" }> | undefined;
        // Where the output goes (reasoning, reply, tool arguments), and live progress while a
        // long tool call is being written (a big write_file can stream for minutes).
        const out = { thinking: 0, text: 0, toolArgs: 0 };
        let writing: { id: string; name: string; chars: number; at: number } | null = null;
        for await (const ev of stream) {
          if (ev.type === "thinking_delta") out.thinking += ev.text.length;
          else if (ev.type === "text_delta") out.text += ev.text.length;
          else if (ev.type === "tool_call_start") writing = { id: ev.id, name: ev.name, chars: 0, at: Number.NEGATIVE_INFINITY };
          else if (ev.type === "tool_call_delta") {
            out.toolArgs += ev.partialJson.length;
            if (writing) {
              writing.chars += ev.partialJson.length;
              const now = performance.now();
              if (now - writing.at > 500) {
                writing.at = now;
                this.emit({ type: "tool_call_progress", runId: this.runId, turn: this.turn, name: writing.name, chars: writing.chars, t: Date.now() });
              }
            }
          }
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
          // Rates over very short windows are burst artefacts (e.g. a tool call sent in one chunk).
          outputTokensPerSec: genMs >= 250 && done.usage.outputTokens ? (done.usage.outputTokens / genMs) * 1000 : null,
          toolCalls: toolCallsOf(done.message).length,
          timings: done.timings,
          outputChars: out,
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
        // An unreachable server is usually restarting or reloading a model: wait longer.
        const base = err instanceof ProviderError && err.code === "unavailable" ? 3000 : 500;
        const delayMs = Math.min(30_000, base * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
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
    this.ledger.observe({ name: c.name, input: c.input, summary, isError: Boolean(out.isError), denied: Boolean(out.denied), content: out.content, changedFiles: out.changedFiles ?? [], turn: this.turn });
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
      preview: out.content.slice(0, 4000),
      t: Date.now(),
    });
    const shot = out.images?.at(-1);
    if (shot) this.emit({ type: "tool_image", runId: this.runId, turn: this.turn, id: c.id, name: c.name, mediaType: shot.mediaType, data: shot.data });
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

  private ledger = new EvidenceLedger();
  private task = "";

  private recall(prompt: string): { block: ContentBlock | null; ids: number[] } {
    const m = this.o.memory;
    if (!m) return { block: null, ids: [] };
    const hits = m.store.search(prompt, m.scopes, m.recallLimit ?? 5);
    if (!hits.length) return { block: null, ids: [] };
    this.emit({ type: "memory_recall", runId: this.runId, turn: this.turn, memories: hits.map((h) => ({ id: h.id, kind: h.kind, trust: h.trust, text: h.text.slice(0, 300) })), t: Date.now() });
    const lines = hits.map((h) => `- [${h.kind}, trust ${h.trust.toFixed(2)}] ${h.text}`);
    return {
      ids: hits.map((h) => h.id),
      block: { type: "text", text: `<memory>\nFrom earlier sessions (lessons are harness-verified; notes are unverified claims; check before relying on them):\n${lines.join("\n")}\n</memory>` },
    };
  }

  private settleMemory(verdict: ReturnType<EvidenceLedger["verdict"]>, recalled: number[]) {
    const lessons = this.ledger.lessons(verdict);
    const m = this.o.memory;
    if (m) {
      try {
        for (const l of lessons) m.store.save({ scope: m.scopes[0]!, kind: "lesson", text: l.text, sourceRun: this.runId });
        if (recalled.length) m.store.reinforce(recalled, verdict === "verified" ? "verified" : verdict === "failed" ? "failed" : "unverified");
      } catch {
        /* memory is best-effort */
      }
    }
    this.emit({ type: "evidence", runId: this.runId, verdict, surprises: this.ledger.surprises, checksPassed: this.ledger.checksPassed, checksFailed: this.ledger.checksFailed, lessons: lessons.map((l) => l.text), t: Date.now() });
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
    const keep = force ? 2 : 6;
    let cut = safeCutIndex(this.messages, keep);
    // One long task has a single plain user message (its prompt), so there is no user
    // boundary to cut at: cut before an assistant turn instead (tool pairs stay intact).
    if (cut <= 0) for (let i = this.messages.length - keep; i >= 2 && cut <= 0; i--) if (this.messages[i]?.role === "assistant") cut = i;
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
      // The task verbatim, harness-observed facts, then the model's own summary (D30).
      { role: "user", content: [{ type: "text", text: `[Earlier conversation compacted]\n<task>\n${this.task}\n</task>\n\n<evidence source="harness">\n${this.ledger.snapshot()}\n</evidence>\n\n<notes source="model">\n${summary}\n</notes>` }] },
      ...(tail[0]?.role === "assistant" ? [] : [{ role: "assistant" as const, content: [{ type: "text" as const, text: "Understood. Continuing from these notes." }] }]),
      ...tail,
    ]);
    // A compaction summary is a faithful record of the session so far: keep it as an episode.
    if (summary.trim() && this.o.memory) {
      try {
        this.o.memory.store.save({ scope: this.o.memory.scopes[0]!, kind: "episode", text: summary, sourceRun: this.runId });
      } catch {
        /* memory is best-effort; never fail a run on it */
      }
    }
    const after = estimateTokens(this.messages, this.o.system);
    this.emit({ type: "compaction", runId: this.runId, turn: this.turn, beforeTokens: before, afterTokens: after, strategy: "summarize", t: Date.now() });
  }
}
