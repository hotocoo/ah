import type { BenchRun, TrialResult } from "./runner.ts";
import { mean, passAtK, passHatK, percentile, significantChange, wilson } from "./stats.ts";

export interface TaskSummary {
  taskId: string;
  name: string;
  category: string;
  difficulty: number;
  language?: string;
  n: number;
  passes: number;
  passRate: number;
  passAt1: number | null;
  passAtK: number | null;
  passHatK: number | null;
  wilson: { low: number; high: number };
  meanWallMs: number | null;
  p95WallMs: number | null;
  meanTurns: number | null;
  meanToolErrors: number | null;
  meanTokens: number | null;
  decodeTps: number | null;
  failReasons: Record<string, number>;
}

export interface BenchSummary {
  model: string;
  benchRunId: string;
  k: number;
  tasks: TaskSummary[];
  overall: {
    trials: number;
    passes: number;
    passRate: number;
    wilson: { low: number; high: number };
    meanPassAt1: number | null;
    meanPassAtK: number | null;
    meanPassHatK: number | null;
    solvedAny: number; // tasks with >= 1 pass
    solvedAll: number; // tasks with all trials passing
    totalWallMs: number;
    p50WallMs: number | null;
    p95WallMs: number | null;
    meanTtftMs: number | null;
    meanPrefillTps: number | null;
    meanDecodeTps: number | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    energyJ: number | null;
    recoveredToolCalls: number;
    toolErrorRate: number | null;
  };
}

const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));

export function summarizeRun(run: BenchRun): BenchSummary {
  const k = run.trials;
  const byTask = new Map<string, TrialResult[]>();
  for (const r of run.results) byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r]);
  const tasks: TaskSummary[] = run.tasks.map((t) => {
    const rs = byTask.get(t.id) ?? [];
    const n = rs.length;
    const passes = rs.filter((r) => r.passed).length;
    const w = wilson(passes, n);
    const fr: Record<string, number> = {};
    for (const r of rs) if (r.failReason) fr[r.failReason] = (fr[r.failReason] ?? 0) + 1;
    return {
      taskId: t.id,
      name: t.name,
      category: t.category,
      difficulty: t.difficulty,
      language: t.language,
      n,
      passes,
      passRate: n ? passes / n : 0,
      passAt1: passAtK(n, passes, 1),
      passAtK: passAtK(n, passes, k),
      passHatK: passHatK(n, passes, k),
      wilson: { low: w.low, high: w.high },
      meanWallMs: mean(rs.map((r) => r.wallMs)),
      p95WallMs: percentile(rs.map((r) => r.wallMs), 0.95),
      meanTurns: mean(rs.map((r) => r.turns)),
      meanToolErrors: mean(rs.map((r) => r.toolErrors)),
      meanTokens: mean(rs.map((r) => r.usage.inputTokens + r.usage.outputTokens)),
      decodeTps: mean(nums(rs.map((r) => r.decodeTps))),
      failReasons: fr,
    };
  });
  const all = run.results;
  const passes = all.filter((r) => r.passed).length;
  const w = wilson(passes, all.length);
  const costs = nums(all.map((r) => r.costUsd));
  const energy = nums(all.map((r) => r.energyJ));
  const toolCalls = all.reduce((a, r) => a + r.toolCalls, 0);
  return {
    model: run.model,
    benchRunId: run.benchRunId,
    k,
    tasks,
    overall: {
      trials: all.length,
      passes,
      passRate: all.length ? passes / all.length : 0,
      wilson: { low: w.low, high: w.high },
      meanPassAt1: mean(nums(tasks.map((t) => t.passAt1))),
      meanPassAtK: mean(nums(tasks.map((t) => t.passAtK))),
      meanPassHatK: mean(nums(tasks.map((t) => t.passHatK))),
      solvedAny: tasks.filter((t) => t.passes > 0).length,
      solvedAll: tasks.filter((t) => t.n > 0 && t.passes === t.n).length,
      totalWallMs: all.reduce((a, r) => a + r.wallMs + r.graderMs, 0),
      p50WallMs: percentile(all.map((r) => r.wallMs), 0.5),
      p95WallMs: percentile(all.map((r) => r.wallMs), 0.95),
      meanTtftMs: mean(nums(all.map((r) => r.ttftMs))),
      meanPrefillTps: mean(nums(all.map((r) => r.prefillTps))),
      meanDecodeTps: mean(nums(all.map((r) => r.decodeTps))),
      inputTokens: all.reduce((a, r) => a + r.usage.inputTokens, 0),
      outputTokens: all.reduce((a, r) => a + r.usage.outputTokens, 0),
      costUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
      energyJ: energy.length ? energy.reduce((a, b) => a + b, 0) : null,
      recoveredToolCalls: all.reduce((a, r) => a + r.recoveredToolCalls, 0),
      toolErrorRate: toolCalls ? all.reduce((a, r) => a + r.toolErrors, 0) / toolCalls : null,
    },
  };
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${(x * 100).toFixed(0)}%`);
const sec = (ms: number | null | undefined) => (ms === null || ms === undefined ? "-" : `${(ms / 1000).toFixed(1)}s`);
const f1 = (x: number | null | undefined) => (x === null || x === undefined ? "-" : x.toFixed(1));
const gb = (b?: number) => (b === undefined ? "-" : `${(b / 1024 ** 3).toFixed(0)} GB`);

export function markdownReport(run: BenchRun, s: BenchSummary): string {
  const o = s.overall;
  const lines: string[] = [];
  lines.push(`# Benchmark: \`${run.model}\``, "");
  lines.push(`- Run: \`${run.benchRunId}\` · ${run.startedAt} → ${run.finishedAt}`);
  lines.push(`- ah ${run.ahVersion}${run.gitSha ? ` @ ${run.gitSha}` : ""} · ${run.trials} trials per task · features: ${JSON.stringify(run.features)}`);
  lines.push(`- Hardware: ${run.hardware.gpuName ?? "?"} · ${gb(run.hardware.memTotalBytes)} · ${run.hardware.cpuCount} threads`);
  if (run.runtime) lines.push(`- Runtime: ${run.runtime.kind} ${run.runtime.version ?? ""} (${run.runtime.baseURL})`);
  const first = run.results.find((r) => r.generation);
  if (first?.generation) lines.push(`- Generation: ${JSON.stringify({ temperature: first.generation.temperature, ...first.generation.sampling, templateKwargs: first.generation.templateKwargs })} (from ${first.generation.source}) · context ${first.contextWindow} · tools ${first.toolProtocol}`);
  if (run.skipped.length) lines.push(`- Skipped: ${run.skipped.map((x) => `${x.taskId} (${x.reason})`).join(", ")}`);
  lines.push("", "## Overall", "");
  lines.push("| metric | value |", "|---|---|");
  lines.push(`| trials passed | ${o.passes}/${o.trials} (${pct(o.passRate)}, 95% CI ${pct(o.wilson.low)}–${pct(o.wilson.high)}) |`);
  lines.push(`| mean pass@1 | ${pct(o.meanPassAt1)} |`);
  lines.push(`| mean pass@${s.k} | ${pct(o.meanPassAtK)} |`);
  lines.push(`| mean pass^${s.k} (all trials pass) | ${pct(o.meanPassHatK)} |`);
  lines.push(`| tasks solved at least once | ${o.solvedAny}/${s.tasks.length} |`);
  lines.push(`| tasks solved every trial | ${o.solvedAll}/${s.tasks.length} |`);
  lines.push(`| wall time p50 / p95 per trial | ${sec(o.p50WallMs)} / ${sec(o.p95WallMs)} |`);
  lines.push(`| mean TTFT | ${sec(o.meanTtftMs)} |`);
  lines.push(`| mean prefill / decode | ${f1(o.meanPrefillTps)} / ${f1(o.meanDecodeTps)} tok/s |`);
  lines.push(`| tokens in / out | ${o.inputTokens} / ${o.outputTokens} |`);
  lines.push(`| tool error rate | ${pct(o.toolErrorRate)} |`);
  lines.push(`| tool calls recovered from text | ${o.recoveredToolCalls} |`);
  if (o.costUsd) lines.push(`| cost | $${o.costUsd.toFixed(4)} |`);
  if (o.energyJ) lines.push(`| energy | ${(o.energyJ / 3600).toFixed(2)} Wh |`);
  lines.push("", "## Per task", "");
  lines.push(`| task | lang | diff. | pass | pass@1 | pass^${s.k} | 95% CI | mean time | turns | tool err | decode tok/s | failures |`);
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const t of s.tasks)
    lines.push(
      `| ${t.taskId} | ${t.language ?? ""} | ${t.difficulty} | ${t.passes}/${t.n} | ${pct(t.passAt1)} | ${pct(t.passHatK)} | ${pct(t.wilson.low)}–${pct(t.wilson.high)} | ${sec(t.meanWallMs)} | ${f1(t.meanTurns)} | ${f1(t.meanToolErrors)} | ${f1(t.decodeTps)} | ${Object.entries(t.failReasons).map(([k, v]) => `${k}×${v}`).join(" ") || "-"} |`,
    );
  const failures = run.results.filter((r) => !r.passed);
  if (failures.length) {
    lines.push("", "## Failed trials", "");
    for (const r of failures) {
      lines.push(`### ${r.taskId} #${r.trial} — ${r.failReason}${r.error ? `: ${r.error.slice(0, 200)}` : ""}`);
      lines.push("", "```", r.graderTail || "(no grader output)", "```", "");
    }
  }
  return `${lines.join("\n")}\n`;
}

export interface Comparison {
  taskId: string;
  baseline: { passes: number; n: number };
  candidate: { passes: number; n: number };
  delta: number;
  verdict: "better" | "worse" | "same";
}

// Per-task comparison; a change counts only when Wilson intervals do not overlap.
export function compareRuns(baseline: BenchRun, candidate: BenchRun): { tasks: Comparison[]; overall: Comparison } {
  const count = (run: BenchRun, id?: string) => {
    const rs = run.results.filter((r) => !id || r.taskId === id);
    return { passes: rs.filter((r) => r.passed).length, n: rs.length };
  };
  const ids = [...new Set([...baseline.results, ...candidate.results].map((r) => r.taskId))].sort();
  const mk = (id: string | undefined): Comparison => {
    const b = count(baseline, id);
    const c = count(candidate, id);
    return { taskId: id ?? "overall", baseline: b, candidate: c, delta: (c.n ? c.passes / c.n : 0) - (b.n ? b.passes / b.n : 0), verdict: significantChange(b, c) };
  };
  return { tasks: ids.map((id) => mk(id)), overall: mk(undefined) };
}

export function markdownComparison(bName: string, cName: string, cmp: ReturnType<typeof compareRuns>): string {
  const rows = [...cmp.tasks, cmp.overall].map(
    (c) => `| ${c.taskId} | ${c.baseline.passes}/${c.baseline.n} | ${c.candidate.passes}/${c.candidate.n} | ${c.delta >= 0 ? "+" : ""}${(c.delta * 100).toFixed(0)} pts | ${c.verdict} |`,
  );
  return `| task | ${bName} | ${cName} | Δ pass rate | significance (Wilson 95%) |\n|---|---|---|---|---|\n${rows.join("\n")}\n`;
}
