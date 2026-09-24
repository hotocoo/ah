import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentEvent } from "../agent/events.ts";

export interface BenchTag {
  benchRunId: string;
  taskId: string;
  trial: number;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  session_id TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  cwd TEXT,
  provider TEXT,
  model TEXT,
  prompt TEXT,
  outcome TEXT,
  turns INTEGER,
  tool_calls INTEGER,
  tool_errors INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  cost_usd REAL,
  wall_ms REAL,
  ttft_ms REAL,
  changed_files TEXT,
  error TEXT,
  ah_version TEXT,
  bench_run_id TEXT,
  bench_task_id TEXT,
  bench_trial INTEGER,
  context_window INTEGER,
  gpu_util_avg REAL,
  gpu_mem_peak INTEGER,
  energy_j REAL
);
CREATE INDEX IF NOT EXISTS runs_started ON runs(started_at);
CREATE INDEX IF NOT EXISTS runs_bench ON runs(bench_run_id);
CREATE TABLE IF NOT EXISTS turns (
  run_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  started_at INTEGER,
  context_tokens INTEGER,
  latency_ms REAL,
  ttft_ms REAL,
  tokens_per_sec REAL,
  stop_reason TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  cost_usd REAL,
  tool_calls INTEGER,
  prefill_tps REAL,
  decode_tps REAL,
  runtime_prompt_ms REAL,
  runtime_cached_tokens INTEGER,
  load_ms REAL,
  gpu_util_avg REAL,
  gpu_util_max REAL,
  gpu_mem_peak INTEGER,
  power_avg_w REAL,
  energy_j REAL,
  PRIMARY KEY (run_id, turn, attempt)
);
CREATE TABLE IF NOT EXISTS tool_calls (
  run_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  call_id TEXT NOT NULL,
  name TEXT NOT NULL,
  started_at INTEGER,
  duration_ms REAL,
  is_error INTEGER,
  denied INTEGER,
  output_chars INTEGER,
  input TEXT,
  changed_files TEXT,
  PRIMARY KEY (run_id, call_id)
);
CREATE INDEX IF NOT EXISTS tool_calls_name ON tool_calls(name);
CREATE TABLE IF NOT EXISTS events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  t INTEGER NOT NULL,
  data TEXT,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS kv_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bench_runs (
  bench_run_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  model TEXT,
  suite TEXT,
  trials INTEGER,
  report TEXT
);
`;

// Durable telemetry store. Also hosts the models cache (kv_cache) and bench summaries,
// so an `ah` install has exactly one database file.
export class TelemetryStore {
  readonly db: Database;
  private seq = new Map<string, number>();
  private attempts = new Map<string, number>();
  private toolStarts = new Map<string, { t: number; input: string }>();
  private benchTags = new Map<string, BenchTag>();
  private cwd = new Map<string, string>();
  private pendingContext = new Map<string, number>();

  constructor(path: string, private version = "0.1.0") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec(SCHEMA);
  }

  tagBench(runId: string, tag: BenchTag): void {
    this.benchTags.set(runId, tag);
  }

  setCwd(runId: string, cwd: string): void {
    this.cwd.set(runId, cwd);
  }

  // Sink entry point. Streaming deltas are not persisted (volume); everything else is.
  record = (e: AgentEvent): void => {
    if (e.type === "text_delta" || e.type === "thinking_delta" || e.type === "tool_image") return;
    const seq = (this.seq.get(e.runId) ?? 0) + 1;
    this.seq.set(e.runId, seq);
    const t = "t" in e ? e.t : Date.now();
    this.db.run("INSERT OR REPLACE INTO events (run_id, seq, type, t, data) VALUES (?, ?, ?, ?, ?)", [e.runId, seq, e.type, t, JSON.stringify(e)]);

    switch (e.type) {
      case "run_start": {
        const tag = this.benchTags.get(e.runId);
        this.db.run(
          "INSERT OR IGNORE INTO runs (run_id, session_id, started_at, cwd, provider, model, prompt, ah_version, bench_run_id, bench_task_id, bench_trial) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [e.runId, e.sessionId, e.t, this.cwd.get(e.runId) ?? process.cwd(), e.provider, e.model, e.prompt.slice(0, 4000), this.version, tag?.benchRunId ?? null, tag?.taskId ?? null, tag?.trial ?? null],
        );
        break;
      }
      case "model_request":
        this.attempts.set(`${e.runId}:${e.turn}`, e.attempt);
        this.db.run("INSERT OR IGNORE INTO turns (run_id, turn, attempt, started_at, context_tokens) VALUES (?, ?, ?, ?, ?)", [e.runId, e.turn, e.attempt, e.t, this.pendingContext.get(`${e.runId}:${e.turn}`) ?? null]);
        break;
      case "turn_start":
        // turn_start precedes model_request; the row is created there and filled on response.
        this.pendingContext.set(`${e.runId}:${e.turn}`, e.contextTokens);
        break;
      case "model_response": {
        const attempt = this.attempts.get(`${e.runId}:${e.turn}`) ?? 1;
        const u = e.usage;
        this.db.run(
          `UPDATE turns SET latency_ms = ?, ttft_ms = ?, tokens_per_sec = ?, stop_reason = ?, input_tokens = ?, output_tokens = ?,
           cache_read_tokens = ?, cache_write_tokens = ?, reasoning_tokens = ?, cost_usd = ?, tool_calls = ?,
           prefill_tps = ?, decode_tps = ?, runtime_prompt_ms = ?, runtime_cached_tokens = ?, load_ms = ?
           WHERE run_id = ? AND turn = ? AND attempt = ?`,
          [e.latencyMs, e.ttftMs, e.outputTokensPerSec, e.stopReason, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens, u.reasoningTokens, e.costUsd, e.toolCalls,
           e.timings?.prefillTokensPerSec ?? null, e.timings?.decodeTokensPerSec ?? null, e.timings?.promptMs ?? null, e.timings?.cachedTokens ?? null, e.timings?.loadMs ?? null,
           e.runId, e.turn, attempt],
        );
        break;
      }
      case "tool_start":
        this.toolStarts.set(`${e.runId}:${e.id}`, { t: e.t, input: JSON.stringify(e.input).slice(0, 8000) });
        break;
      case "tool_end": {
        const s = this.toolStarts.get(`${e.runId}:${e.id}`);
        this.db.run(
          "INSERT OR REPLACE INTO tool_calls (run_id, turn, call_id, name, started_at, duration_ms, is_error, denied, output_chars, input, changed_files) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [e.runId, e.turn, e.id, e.name, s?.t ?? e.t, e.durationMs, e.isError ? 1 : 0, e.denied ? 1 : 0, e.outputChars, s?.input ?? null, JSON.stringify(e.changedFiles)],
        );
        break;
      }
      case "run_end": {
        const r = e.result;
        this.db.run(
          `UPDATE runs SET ended_at = ?, outcome = ?, turns = ?, tool_calls = ?, tool_errors = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?,
           cache_write_tokens = ?, reasoning_tokens = ?, cost_usd = ?, wall_ms = ?, ttft_ms = ?, changed_files = ?, error = ? WHERE run_id = ?`,
          [e.t, r.outcome, r.turns, r.toolCalls, r.toolErrors, r.usage.inputTokens, r.usage.outputTokens, r.usage.cacheReadTokens, r.usage.cacheWriteTokens, r.usage.reasoningTokens, r.costUsd, r.wallMs, r.ttftMs, JSON.stringify(r.changedFiles), r.error ?? null, e.runId],
        );
        break;
      }
    }
  };

  recordHardware(runId: string, turn: number | null, s: { gpuUtilAvg?: number; gpuUtilMax?: number; gpuMemPeakBytes?: number; powerAvgW?: number; energyJ?: number }): void {
    if (turn === null) {
      this.db.run("UPDATE runs SET gpu_util_avg = ?, gpu_mem_peak = ?, energy_j = ? WHERE run_id = ?", [s.gpuUtilAvg ?? null, s.gpuMemPeakBytes ?? null, s.energyJ ?? null, runId]);
      return;
    }
    this.db.run(
      "UPDATE turns SET gpu_util_avg = ?, gpu_util_max = ?, gpu_mem_peak = ?, power_avg_w = ?, energy_j = ? WHERE run_id = ? AND turn = ?",
      [s.gpuUtilAvg ?? null, s.gpuUtilMax ?? null, s.gpuMemPeakBytes ?? null, s.powerAvgW ?? null, s.energyJ ?? null, runId, turn],
    );
  }

  setContextWindow(runId: string, window: number): void {
    this.db.run("UPDATE runs SET context_window = ? WHERE run_id = ?", [window, runId]);
  }

  cacheGet(key: string, maxAgeMs: number): string | null {
    const row = this.db.query("SELECT value, fetched_at FROM kv_cache WHERE key = ?").get(key) as { value: string; fetched_at: number } | null;
    if (!row || Date.now() - row.fetched_at > maxAgeMs) return null;
    return row.value;
  }

  cacheSet(key: string, value: string): void {
    this.db.run("INSERT OR REPLACE INTO kv_cache (key, value, fetched_at) VALUES (?, ?, ?)", [key, value, Date.now()]);
  }

  close(): void {
    this.db.close();
  }
}
