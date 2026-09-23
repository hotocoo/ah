import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { TelemetryStore } from "../telemetry/store.ts";
import { byModel, byTool, recentRuns, runDetail, summary, type Dist } from "../telemetry/metrics.ts";
import { bold, cyan, dim, green, red } from "./render.ts";
import { join } from "node:path";

const HELP = `ah telemetry — local telemetry (SQLite at <dataDir>/telemetry.sqlite)

  ah telemetry [summary] [--since 24h] [--model M] [--json]   Totals, latency/throughput distributions, cache hit rate
  ah telemetry runs [--limit N]                               Recent runs
  ah telemetry run <run_id>                                   One run: turns, tool calls, events
  ah telemetry tools | models                                 Tool health / per-model breakdown
  ah telemetry sql "<SELECT ...>"                             Read-only query
`;

const SPANS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
const parseSince = (s?: string) => {
  const m = s?.match(/^(\d+)([mhd])$/);
  return m ? Number(m[1]) * SPANS[m[2]!]! : undefined;
};
const n = (x: number | null | undefined, d = 0) => (x === null || x === undefined ? "-" : x.toFixed(d));
const distLine = (label: string, d: Dist, unit = "") => `  ${label.padEnd(18)} n=${String(d.n).padEnd(5)} mean ${n(d.mean, 1)}${unit}  p50 ${n(d.p50, 1)}${unit}  p95 ${n(d.p95, 1)}${unit}  max ${n(d.max, 1)}${unit}`;

export async function cmdTelemetry(argv: string[]): Promise<number> {
  const { values: v, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: false, options: { since: { type: "string" }, model: { type: "string" }, limit: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean" } } });
  if (v.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const cfg = loadConfig();
  const store = new TelemetryStore(join(cfg.dataDir, "telemetry.sqlite"));
  const filter = { sinceMs: parseSince(v.since as string | undefined), model: v.model as string | undefined };
  const out = (data: unknown, text: () => string) => process.stdout.write(v.json ? `${JSON.stringify(data, null, 2)}\n` : `${text()}\n`);
  const [sub = "summary", arg] = positionals;
  switch (sub) {
    case "summary": {
      const s = summary(store.db, filter);
      const t = s.totals;
      out(s, () =>
        [
          bold("Totals"),
          `  runs ${t.runs} (completed ${t.completed ?? 0}) · turns ${t.turns ?? 0} · tool calls ${t.tool_calls ?? 0} (error rate ${n((s.totals.toolErrorRate ?? 0) * 100)}%)`,
          `  tokens in ${t.input_tokens ?? 0} (cache hit ${n((s.totals.cacheHitRate ?? 0) * 100)}%) · out ${t.output_tokens ?? 0} · reasoning ${t.reasoning_tokens ?? 0} · cost $${n(t.cost_usd ?? 0, 4)}`,
          bold("\nOutcomes"),
          ...(s.outcomes as { outcome: string; n: number }[]).map((o) => `  ${o.outcome ?? "running"}: ${o.n}`),
          bold("\nDistributions"),
          distLine("turn latency", s.turnLatencyMs, "ms"),
          distLine("TTFT", s.ttftMs, "ms"),
          distLine("decode tok/s", s.tokensPerSec),
          distLine("run wall", s.runWallMs, "ms"),
          distLine("turns/run", s.runTurns),
          distLine("context tokens", s.contextTokens),
        ].join("\n"),
      );
      return 0;
    }
    case "runs": {
      const rows = recentRuns(store.db, Number(v.limit ?? 20), filter) as Record<string, unknown>[];
      out(rows, () =>
        rows
          .map((r) => `${cyan(String(r.run_id))} ${new Date(Number(r.started_at)).toLocaleString()} ${r.outcome === "completed" ? green(String(r.outcome)) : red(String(r.outcome ?? "running"))} ${dim(`${r.provider}/${r.model} · ${r.turns} turns · ${r.tool_calls} tools · ${n(Number(r.wall_ms) / 1000, 1)}s${r.bench_task_id ? ` · bench ${r.bench_task_id}#${r.bench_trial}` : ""}`)}`)
          .join("\n") || "no runs",
      );
      return 0;
    }
    case "run": {
      if (!arg) throw new Error("usage: ah telemetry run <run_id>");
      const d = runDetail(store.db, arg);
      out(d, () => JSON.stringify(d, null, 2));
      return 0;
    }
    case "tools": {
      const rows = byTool(store.db, filter);
      out(rows, () => rows.map((r) => `${r.name.padEnd(16)} calls ${String(r.calls).padEnd(5)} errors ${n(r.errorRate * 100)}%  denied ${r.denied}  p50 ${n(r.durationMs.p50)}ms  p95 ${n(r.durationMs.p95)}ms`).join("\n") || "no tool calls");
      return 0;
    }
    case "models": {
      const rows = byModel(store.db, filter) as Record<string, number | string>[];
      out(rows, () => rows.map((r) => `${cyan(`${r.provider}/${r.model}`)} runs ${r.runs} completed ${r.completed} · avg wall ${n(Number(r.avg_wall_ms) / 1000, 1)}s · avg TTFT ${n(Number(r.avg_ttft_ms))}ms · cost $${n(Number(r.cost_usd ?? 0), 4)}`).join("\n") || "no runs");
      return 0;
    }
    case "sql": {
      if (!arg || !/^\s*(select|with|pragma table_info)/i.test(arg)) throw new Error("only SELECT/WITH queries are allowed");
      // Separate read-only connection: the query cannot modify the store.
      const { Database } = await import("bun:sqlite");
      const ro = new Database(join(cfg.dataDir, "telemetry.sqlite"), { readonly: true });
      const rows = ro.query(arg).all();
      ro.close();
      out(rows, () => JSON.stringify(rows, null, 2));
      return 0;
    }
    default:
      process.stdout.write(HELP);
      return 2;
  }
}
