import type { Database } from "bun:sqlite";

export interface Dist {
  n: number;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function dist(values: (number | null | undefined)[]): Dist {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  return {
    n: v.length,
    mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null,
    p50: quantile(v, 0.5),
    p90: quantile(v, 0.9),
    p95: quantile(v, 0.95),
    p99: quantile(v, 0.99),
    max: v.length ? v[v.length - 1]! : null,
  };
}

export interface Filter {
  sinceMs?: number;
  model?: string;
  provider?: string;
  benchRunId?: string;
}

function where(f: Filter, alias = "r"): { sql: string; params: (string | number)[] } {
  const c: string[] = [];
  const p: (string | number)[] = [];
  if (f.sinceMs) (c.push(`${alias}.started_at >= ?`), p.push(Date.now() - f.sinceMs));
  if (f.model) (c.push(`${alias}.model = ?`), p.push(f.model));
  if (f.provider) (c.push(`${alias}.provider = ?`), p.push(f.provider));
  if (f.benchRunId) (c.push(`${alias}.bench_run_id = ?`), p.push(f.benchRunId));
  return { sql: c.length ? `WHERE ${c.join(" AND ")}` : "", params: p };
}

export interface Totals {
  runs: number;
  turns: number | null;
  tool_calls: number | null;
  tool_errors: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: number | null;
  completed: number | null;
}

// Aggregate dashboard: totals, latency distributions, cache efficiency, tool health.
export function summary(db: Database, f: Filter = {}) {
  const w = where(f);
  const totals = db
    .query(
      `SELECT COUNT(*) runs, SUM(turns) turns, SUM(tool_calls) tool_calls, SUM(tool_errors) tool_errors,
       SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens, SUM(cache_read_tokens) cache_read_tokens,
       SUM(cache_write_tokens) cache_write_tokens, SUM(reasoning_tokens) reasoning_tokens, SUM(cost_usd) cost_usd,
       SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) completed
       FROM runs r ${w.sql}`,
    )
    .get(...w.params) as Totals;
  const runs = db.query(`SELECT wall_ms, ttft_ms, cost_usd, turns FROM runs r ${w.sql}`).all(...w.params) as { wall_ms: number; ttft_ms: number; cost_usd: number; turns: number }[];
  const turnRows = db
    .query(`SELECT t.latency_ms, t.ttft_ms, t.tokens_per_sec, t.context_tokens FROM turns t JOIN runs r ON r.run_id = t.run_id ${w.sql}`)
    .all(...w.params) as { latency_ms: number; ttft_ms: number; tokens_per_sec: number; context_tokens: number }[];
  const outcomes = db.query(`SELECT outcome, COUNT(*) n FROM runs r ${w.sql} GROUP BY outcome ORDER BY n DESC`).all(...w.params);
  const input = totals.input_tokens ?? 0;
  return {
    totals: { ...totals, cacheHitRate: input ? (totals.cache_read_tokens ?? 0) / input : null, toolErrorRate: totals.tool_calls ? (totals.tool_errors ?? 0) / totals.tool_calls : null },
    outcomes,
    runWallMs: dist(runs.map((r) => r.wall_ms)),
    runCostUsd: dist(runs.map((r) => r.cost_usd)),
    runTurns: dist(runs.map((r) => r.turns)),
    turnLatencyMs: dist(turnRows.map((r) => r.latency_ms)),
    ttftMs: dist(turnRows.map((r) => r.ttft_ms)),
    tokensPerSec: dist(turnRows.map((r) => r.tokens_per_sec)),
    contextTokens: dist(turnRows.map((r) => r.context_tokens)),
  };
}

export function byModel(db: Database, f: Filter = {}) {
  const w = where(f);
  return db
    .query(
      `SELECT provider, model, COUNT(*) runs, SUM(CASE WHEN outcome='completed' THEN 1 ELSE 0 END) completed,
       AVG(wall_ms) avg_wall_ms, AVG(ttft_ms) avg_ttft_ms, SUM(cost_usd) cost_usd, SUM(input_tokens) input_tokens,
       SUM(output_tokens) output_tokens, SUM(cache_read_tokens) cache_read_tokens, AVG(turns) avg_turns
       FROM runs r ${w.sql} GROUP BY provider, model ORDER BY runs DESC`,
    )
    .all(...w.params);
}

export function byTool(db: Database, f: Filter = {}) {
  const w = where(f);
  const rows = db
    .query(`SELECT c.name, c.duration_ms, c.is_error, c.denied, c.output_chars FROM tool_calls c JOIN runs r ON r.run_id = c.run_id ${w.sql}`)
    .all(...w.params) as { name: string; duration_ms: number; is_error: number; denied: number; output_chars: number }[];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.name, [...(groups.get(r.name) ?? []), r]);
  return [...groups.entries()]
    .map(([name, g]) => ({
      name,
      calls: g.length,
      errors: g.filter((r) => r.is_error).length,
      denied: g.filter((r) => r.denied).length,
      errorRate: g.filter((r) => r.is_error).length / g.length,
      durationMs: dist(g.map((r) => r.duration_ms)),
      avgOutputChars: g.reduce((a, r) => a + r.output_chars, 0) / g.length,
    }))
    .sort((a, b) => b.calls - a.calls);
}

export function timeseries(db: Database, bucketMs: number, f: Filter = {}) {
  const w = where(f);
  return db
    .query(
      `SELECT (started_at / ?) * ? bucket, COUNT(*) runs, SUM(cost_usd) cost_usd, SUM(input_tokens + output_tokens) tokens, AVG(wall_ms) avg_wall_ms
       FROM runs r ${w.sql} GROUP BY bucket ORDER BY bucket`,
    )
    .all(bucketMs, bucketMs, ...w.params);
}

export function recentRuns(db: Database, limit = 50, f: Filter = {}) {
  const w = where(f);
  return db.query(`SELECT * FROM runs r ${w.sql} ORDER BY started_at DESC LIMIT ?`).all(...w.params, limit);
}

export function runDetail(db: Database, runId: string) {
  return {
    run: db.query("SELECT * FROM runs WHERE run_id = ?").get(runId),
    turns: db.query("SELECT * FROM turns WHERE run_id = ? ORDER BY turn, attempt").all(runId),
    // Failed calls carry the start of their output (kept in the event log) so failures read on their own.
    tools: db
      .query(
        `SELECT c.*, CASE WHEN c.is_error = 1 THEN (SELECT json_extract(e.data, '$.preview') FROM events e WHERE e.run_id = c.run_id AND e.type = 'tool_end' AND json_extract(e.data, '$.id') = c.call_id LIMIT 1) END AS error
         FROM tool_calls c WHERE c.run_id = ? ORDER BY c.started_at`,
      )
      .all(runId),
    events: db.query("SELECT seq, type, t, data FROM events WHERE run_id = ? ORDER BY seq").all(runId),
  };
}
