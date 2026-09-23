import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent, AgentEventHandler } from "../agent/events.ts";
import type { AhConfig } from "../config.ts";
import { OtlpExporter } from "./otlp.ts";
import { TelemetryStore } from "./store.ts";

// Fans one agent event stream out to every sink. Sinks are isolated: a failing sink
// is reported once and never interrupts the run.
export class Telemetry {
  private sinks: AgentEventHandler[] = [];
  private failed = new Set<number>();
  readonly store: TelemetryStore | null;
  readonly otlp: OtlpExporter | null;

  constructor(opts: { store?: TelemetryStore | null; otlp?: OtlpExporter | null; jsonlDir?: string } = {}) {
    this.store = opts.store ?? null;
    this.otlp = opts.otlp ?? null;
    if (this.store) this.sinks.push(this.store.record);
    if (this.otlp) this.sinks.push(this.otlp.record);
    if (opts.jsonlDir) this.sinks.push(jsonlSink(opts.jsonlDir));
  }

  static fromConfig(cfg: AhConfig): Telemetry {
    if (!cfg.telemetry.enabled) return new Telemetry();
    return new Telemetry({
      store: new TelemetryStore(join(cfg.dataDir, "telemetry.sqlite")),
      otlp: cfg.telemetry.otlpEndpoint ? new OtlpExporter(cfg.telemetry.otlpEndpoint, cfg.telemetry.otlpHeaders) : null,
      jsonlDir: join(cfg.dataDir, "events"),
    });
  }

  add(sink: AgentEventHandler): () => void {
    this.sinks.push(sink);
    return () => {
      const i = this.sinks.indexOf(sink);
      if (i >= 0) this.sinks.splice(i, 1);
    };
  }

  handler: AgentEventHandler = (e: AgentEvent) => {
    this.sinks.forEach((s, i) => {
      try {
        s(e);
      } catch (err) {
        if (!this.failed.has(i)) {
          this.failed.add(i);
          process.stderr.write(`[ah] telemetry sink ${i} failed: ${(err as Error).message}\n`);
        }
      }
    });
  };

  async flush(): Promise<void> {
    await this.otlp?.flush();
  }
}

// One JSONL file per day; streaming deltas omitted.
function jsonlSink(dir: string): AgentEventHandler {
  mkdirSync(dir, { recursive: true });
  return (e) => {
    if (e.type === "text_delta" || e.type === "thinking_delta") return;
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(join(dir, `${day}.jsonl`), `${JSON.stringify(e)}\n`);
  };
}

export { TelemetryStore } from "./store.ts";
export { OtlpExporter } from "./otlp.ts";
