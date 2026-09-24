import type { RuntimeTimings, StopReason, Usage } from "../core/types.ts";
import type { Verdict } from "./evidence.ts";

// Every observable step of an agent run. Timestamps are epoch ms (Date.now()) and
// monotonic offsets are measured with performance.now() inside the loop, so
// telemetry, the CLI renderer and the web UI all consume the same stream.
export type AgentEvent =
  | { type: "run_start"; runId: string; sessionId: string; model: string; provider: string; prompt: string; t: number }
  | { type: "turn_start"; runId: string; turn: number; contextTokens: number; t: number }
  | { type: "model_request"; runId: string; turn: number; attempt: number; t: number }
  | { type: "first_token"; runId: string; turn: number; ttftMs: number; t: number }
  | { type: "text_delta"; runId: string; turn: number; text: string }
  | { type: "thinking_delta"; runId: string; turn: number; text: string }
  | {
      type: "model_response";
      runId: string;
      turn: number;
      stopReason: StopReason;
      usage: Usage;
      costUsd: number | null;
      latencyMs: number;
      ttftMs: number | null;
      outputTokensPerSec: number | null;
      toolCalls: number;
      timings?: RuntimeTimings;
      t: number;
    }
  | { type: "tool_calls_recovered"; runId: string; turn: number; count: number; formats: string[]; t: number }
  | { type: "context_truncated"; runId: string; turn: number; reportedTokens: number; estimatedTokens: number; window: number; t: number }
  | { type: "retry"; runId: string; turn: number; attempt: number; reason: string; delayMs: number; t: number }
  | { type: "tool_start"; runId: string; turn: number; id: string; name: string; input: Record<string, unknown>; summary: string; t: number }
  | {
      type: "tool_end";
      runId: string;
      turn: number;
      id: string;
      name: string;
      durationMs: number;
      isError: boolean;
      denied: boolean;
      outputChars: number;
      changedFiles: string[];
      preview: string;
      t: number;
    }
  | { type: "compaction"; runId: string; turn: number; beforeTokens: number; afterTokens: number; strategy: "elide" | "summarize"; t: number }
  | { type: "error"; runId: string; turn: number; message: string; t: number }
  | { type: "memory_recall"; runId: string; turn: number; memories: { id: number; kind: string; trust: number; text: string }[]; t: number }
  | { type: "evidence_gate"; runId: string; turn: number; files: string[]; lastFailed: boolean; t: number }
  | { type: "evidence"; runId: string; verdict: Verdict; surprises: number; checksPassed: number; checksFailed: number; lessons: string[]; t: number }
  | { type: "run_end"; runId: string; result: RunSummary; t: number };

export type RunOutcome = "completed" | "max_turns" | "max_tokens" | "refusal" | "budget" | "aborted" | "error";

export interface RunSummary {
  runId: string;
  outcome: RunOutcome;
  finalText: string;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  usage: Usage;
  costUsd: number | null;
  wallMs: number;
  ttftMs: number | null; // first turn
  changedFiles: string[];
  // What the harness observed, independent of the model's account (see evidence.ts).
  verdict?: Verdict;
  error?: string;
}

export type AgentEventHandler = (e: AgentEvent) => void;
