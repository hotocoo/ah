import { randomBytes } from "node:crypto";
import type { AgentEvent } from "../agent/events.ts";

// Minimal OTLP/HTTP JSON trace exporter using OpenTelemetry GenAI semantic conventions.
// Span tree per run: invoke_agent (run) -> chat (model turn) and execute_tool (tool call).
type AttrValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean };
interface Attr {
  key: string;
  value: AttrValue;
}
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number; // 1 internal, 3 client
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Attr[];
  status: { code: number; message?: string }; // 1 ok, 2 error
}

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const nanos = (ms: number) => `${BigInt(Math.round(ms)) * 1_000_000n}`;

function attr(key: string, v: string | number | boolean | null | undefined): Attr | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return { key, value: { stringValue: v } };
  if (typeof v === "boolean") return { key, value: { boolValue: v } };
  return Number.isInteger(v) ? { key, value: { intValue: String(v) } } : { key, value: { doubleValue: v } };
}
const attrs = (o: Record<string, string | number | boolean | null | undefined>): Attr[] =>
  Object.entries(o)
    .map(([k, v]) => attr(k, v))
    .filter((a): a is Attr => a !== null);

interface RunState {
  traceId: string;
  spanId: string;
  start: number;
  provider: string;
  model: string;
  turnSpans: Map<number, { spanId: string; start: number }>;
  toolSpans: Map<string, { spanId: string; start: number; name: string }>;
}

export class OtlpExporter {
  private runs = new Map<string, RunState>();
  private buffer: OtlpSpan[] = [];
  readonly exported: OtlpSpan[] = []; // kept for tests / inspection when no endpoint

  constructor(
    private endpoint?: string,
    private headers: Record<string, string> = {},
    private serviceName = "ah",
  ) {}

  record = (e: AgentEvent): void => {
    if (e.type === "run_start") {
      this.runs.set(e.runId, { traceId: hex(16), spanId: hex(8), start: e.t, provider: e.provider, model: e.model, turnSpans: new Map(), toolSpans: new Map() });
      return;
    }
    const run = this.runs.get(e.runId);
    if (!run) return;
    const common = { "gen_ai.system": run.provider, "gen_ai.request.model": run.model };
    switch (e.type) {
      case "model_request":
        run.turnSpans.set(e.turn, { spanId: hex(8), start: e.t });
        break;
      case "model_response": {
        const s = run.turnSpans.get(e.turn);
        if (!s) break;
        this.push(run, s.spanId, `chat ${run.model}`, 3, s.start, e.t, {
          ...common,
          "gen_ai.operation.name": "chat",
          "gen_ai.response.finish_reasons": e.stopReason,
          "gen_ai.usage.input_tokens": e.usage.inputTokens,
          "gen_ai.usage.output_tokens": e.usage.outputTokens,
          "gen_ai.usage.cache_read_input_tokens": e.usage.cacheReadTokens,
          "gen_ai.usage.cache_creation_input_tokens": e.usage.cacheWriteTokens,
          "gen_ai.usage.reasoning_tokens": e.usage.reasoningTokens,
          "ah.turn": e.turn,
          "ah.ttft_ms": e.ttftMs,
          "ah.output_tokens_per_sec": e.outputTokensPerSec,
          "ah.cost_usd": e.costUsd,
          "ah.tool_calls": e.toolCalls,
        });
        break;
      }
      case "tool_start":
        run.toolSpans.set(e.id, { spanId: hex(8), start: e.t, name: e.name });
        break;
      case "tool_end": {
        const s = run.toolSpans.get(e.id);
        if (!s) break;
        this.push(
          run,
          s.spanId,
          `execute_tool ${e.name}`,
          1,
          s.start,
          e.t,
          { ...common, "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": e.name, "gen_ai.tool.call.id": e.id, "ah.turn": e.turn, "ah.denied": e.denied, "ah.output_chars": e.outputChars },
          e.isError ? "tool error" : undefined,
        );
        break;
      }
      case "run_end": {
        const r = e.result;
        this.push(
          run,
          run.spanId,
          `invoke_agent ah`,
          1,
          run.start,
          e.t,
          {
            ...common,
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.usage.input_tokens": r.usage.inputTokens,
            "gen_ai.usage.output_tokens": r.usage.outputTokens,
            "ah.outcome": r.outcome,
            "ah.turns": r.turns,
            "ah.tool_calls": r.toolCalls,
            "ah.tool_errors": r.toolErrors,
            "ah.cost_usd": r.costUsd,
            "ah.ttft_ms": r.ttftMs,
          },
          r.outcome === "error" ? r.error : undefined,
          true,
        );
        this.runs.delete(e.runId);
        void this.flush();
        break;
      }
    }
  };

  private push(run: RunState, spanId: string, name: string, kind: number, start: number, end: number, a: Record<string, string | number | boolean | null | undefined>, error?: string, root = false) {
    this.buffer.push({
      traceId: run.traceId,
      spanId,
      ...(root ? {} : { parentSpanId: run.spanId }),
      name,
      kind,
      startTimeUnixNano: nanos(start),
      endTimeUnixNano: nanos(Math.max(end, start)),
      attributes: attrs(a),
      status: error ? { code: 2, message: error.slice(0, 500) } : { code: 1 },
    });
  }

  payload(spans: OtlpSpan[]) {
    return {
      resourceSpans: [
        {
          resource: { attributes: attrs({ "service.name": this.serviceName, "service.version": "0.1.0" }) },
          scopeSpans: [{ scope: { name: "ah.agent", version: "0.1.0" }, spans }],
        },
      ],
    };
  }

  private flushing: Promise<void> = Promise.resolve();

  // Sends buffered spans. Never throws: telemetry must not break a run.
  flush(): Promise<void> {
    const spans = this.buffer.splice(0);
    if (!spans.length) return this.flushing;
    this.exported.push(...spans);
    if (!this.endpoint) return this.flushing;
    const url = `${this.endpoint.replace(/\/$/, "")}/v1/traces`;
    this.flushing = this.flushing.then(async () => {
      try {
        await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...this.headers },
          body: JSON.stringify(this.payload(spans)),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Collector unavailable: drop silently, spans stay in SQLite.
      }
    });
    return this.flushing;
  }
}
