import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSession, type Environment, type SessionFeatures } from "../app/session.ts";
import type { AgentEventHandler } from "../agent/events.ts";
import type { Usage } from "../core/types.ts";
import { parseModelRef } from "../config.ts";
import { MockProvider } from "../providers/mock.ts";
import { sampleHardware, type HardwareSample } from "../runtimes/hardware.ts";
import { exec } from "../tools/shell.ts";
import { requiredBinaries, type BenchTask } from "./task.ts";

export interface TrialResult {
  taskId: string;
  trial: number;
  passed: boolean;
  failReason: "grader" | "timeout" | "agent_error" | "max_turns" | "max_tokens" | "refusal" | "budget" | null;
  outcome: string;
  runId: string;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  recoveredToolCalls: number;
  usage: Usage;
  costUsd: number | null;
  wallMs: number;
  ttftMs: number | null;
  graderMs: number;
  graderTail: string;
  changedFiles: string[];
  diffStat: string;
  prefillTps: number | null;
  decodeTps: number | null;
  gpuUtilAvg: number | null;
  energyJ: number | null;
  contextWindow: number;
  generation?: { temperature?: number; sampling?: Record<string, number | undefined>; templateKwargs?: Record<string, unknown>; source: string };
  toolProtocol?: string;
  error?: string;
}

export interface BenchRunOptions {
  env: Environment;
  model: string;
  tasks: BenchTask[];
  trials: number;
  outDir: string;
  benchRunId: string;
  features?: SessionFeatures;
  keepWorkdirs?: boolean;
  onTrial?: (r: TrialResult, t: BenchTask) => void;
  onEvent?: AgentEventHandler;
  signal?: AbortSignal;
}

export interface BenchRun {
  benchRunId: string;
  model: string;
  startedAt: string;
  finishedAt: string;
  trials: number;
  features: SessionFeatures;
  hardware: HardwareSample;
  runtime?: { kind: string; version?: string; baseURL: string };
  ahVersion: string;
  gitSha: string | null;
  skipped: { taskId: string; reason: string }[];
  tasks: BenchTask[];
  results: TrialResult[];
}

const GIT_ENV = { GIT_AUTHOR_NAME: "ah-bench", GIT_AUTHOR_EMAIL: "bench@ah.local", GIT_COMMITTER_NAME: "ah-bench", GIT_COMMITTER_EMAIL: "bench@ah.local" };

async function sh(cmd: string, cwd: string, timeoutMs: number, env: Record<string, string> = {}) {
  return exec(cmd, { root: cwd, env }, timeoutMs);
}

async function gitSha(dir: string): Promise<string | null> {
  const r = await sh("git rev-parse --short HEAD", dir, 5000);
  return r.code === 0 ? r.stdout.trim() : null;
}

function prepareSandbox(task: BenchTask, dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(task.fixtureDir, dir, { recursive: true });
}

// Runs one trial: fresh sandbox, agent confined to it, then hidden files + grader.
export async function runTrial(o: BenchRunOptions, task: BenchTask, trial: number): Promise<TrialResult> {
  const dir = resolve(o.outDir, "work", task.id, String(trial));
  prepareSandbox(task, dir);
  await sh("git init -q && git add -A && git commit -qm fixture", dir, 20_000, GIT_ENV);
  if (task.setup) await sh(task.setup, dir, task.limits.timeoutMs);

  const { provider } = parseModelRef(o.model);
  let model = o.model;
  if (provider === "mock") {
    // Scripted reference solution for this task.
    (o.env.registry.get("mock") as MockProvider).setScript(task.mockScript, task.id);
    model = `mock/${task.id}`;
  }
  const timeout = AbortSignal.timeout(task.limits.timeoutMs);
  const signal = o.signal ? AbortSignal.any([timeout, o.signal]) : timeout;
  let recovered = 0;
  const s = await createSession(o.env, {
    model,
    root: dir,
    mode: "auto",
    maxTurns: task.limits.maxTurns,
    budgetUsd: task.limits.maxCostUsd,
    signal,
    // Trials must be independent and comparable: no memory, no user extensions.
    features: { ...o.features, memory: false, extensions: false },
    onEvent: (e) => {
      if (e.type === "tool_calls_recovered") recovered += e.count;
      o.onEvent?.(e);
    },
  });
  o.env.telemetry.store?.tagBench(s.agent.runId, { benchRunId: o.benchRunId, taskId: task.id, trial });
  const summary = await s.agent.run(task.prompt);
  const diff = await sh("git add -A && git diff --cached --stat HEAD | tail -1", dir, 20_000, GIT_ENV);

  // Hidden graders are copied in only now, so the agent cannot read or edit them.
  if (task.hiddenDir) cpSync(task.hiddenDir, dir, { recursive: true, force: true });
  const g = await sh(task.grader.cmd, dir, task.grader.timeoutMs);
  const passed = g.code === 0 && !g.timedOut;

  const row = o.env.telemetry.store?.db
    // Runtime-reported rates when available, otherwise ah's own measurement.
    .query("SELECT AVG(prefill_tps) p, AVG(COALESCE(decode_tps, tokens_per_sec)) d FROM turns WHERE run_id = ?")
    .get(summary.runId) as { p: number | null; d: number | null } | undefined;
  const run = o.env.telemetry.store?.db.query("SELECT gpu_util_avg, energy_j FROM runs WHERE run_id = ?").get(summary.runId) as
    | { gpu_util_avg: number | null; energy_j: number | null }
    | undefined;

  const failReason: TrialResult["failReason"] = passed
    ? null
    : summary.outcome === "aborted"
      ? "timeout"
      : summary.outcome === "error"
        ? "agent_error"
        : summary.outcome === "completed"
          ? "grader"
          : (summary.outcome as TrialResult["failReason"]);
  if (!o.keepWorkdirs && passed) rmSync(dir, { recursive: true, force: true });
  return {
    taskId: task.id,
    trial,
    passed,
    failReason,
    outcome: summary.outcome,
    runId: summary.runId,
    turns: summary.turns,
    toolCalls: summary.toolCalls,
    toolErrors: summary.toolErrors,
    recoveredToolCalls: recovered,
    usage: summary.usage,
    costUsd: summary.costUsd,
    wallMs: summary.wallMs,
    ttftMs: summary.ttftMs,
    graderMs: g.durationMs,
    graderTail: `${g.stdout}\n${g.stderr}`.trim().split("\n").slice(-12).join("\n"),
    changedFiles: summary.changedFiles,
    diffStat: diff.stdout.trim(),
    prefillTps: row?.p ?? null,
    decodeTps: row?.d ?? null,
    gpuUtilAvg: run?.gpu_util_avg ?? null,
    energyJ: run?.energy_j ?? null,
    contextWindow: s.context.window,
    generation: s.generation,
    toolProtocol: s.toolProtocol,
    ...(summary.error ? { error: summary.error } : {}),
  };
}

export async function runBench(o: BenchRunOptions): Promise<BenchRun> {
  mkdirSync(o.outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const hardware = await sampleHardware();
  const skipped: BenchRun["skipped"] = [];
  const runnable = o.tasks.filter((t) => {
    const missing = requiredBinaries(t).filter((b) => !Bun.which(b));
    if (missing.length) skipped.push({ taskId: t.id, reason: `missing ${missing.join(", ")}` });
    return !missing.length;
  });
  const results: TrialResult[] = [];
  for (const task of runnable)
    for (let trial = 1; trial <= o.trials; trial++) {
      if (o.signal?.aborted) break;
      let r: TrialResult;
      try {
        r = await runTrial(o, task, trial);
      } catch (err) {
        r = emptyResult(task.id, trial, (err as Error).message);
      }
      results.push(r);
      o.onTrial?.(r, task);
    }
  const { provider } = parseModelRef(o.model);
  const rt = o.env.registry.runtimes.get(provider);
  const run: BenchRun = {
    benchRunId: o.benchRunId,
    model: o.model,
    startedAt,
    finishedAt: new Date().toISOString(),
    trials: o.trials,
    features: o.features ?? {},
    hardware,
    runtime: rt ? { kind: rt.kind, version: rt.version, baseURL: rt.baseURL } : undefined,
    ahVersion: "0.1.0",
    gitSha: await gitSha(process.cwd()),
    skipped,
    tasks: runnable,
    results,
  };
  writeFileSync(join(o.outDir, "results.json"), JSON.stringify({ ...run, tasks: run.tasks.map(({ mockScript: _m, ...t }) => t) }, null, 2));
  o.env.telemetry.store?.db.run("INSERT OR REPLACE INTO bench_runs (bench_run_id, started_at, model, suite, trials, report) VALUES (?, ?, ?, ?, ?, ?)", [
    o.benchRunId,
    Date.parse(startedAt),
    o.model,
    runnable.map((t) => t.id).join(","),
    o.trials,
    join(o.outDir, "results.json"),
  ]);
  if (!o.keepWorkdirs && existsSync(join(o.outDir, "work"))) {
    // Failed trials' workdirs stay for inspection; passed ones were removed per trial.
  }
  return run;
}

function emptyResult(taskId: string, trial: number, error: string): TrialResult {
  return {
    taskId,
    trial,
    passed: false,
    failReason: "agent_error",
    outcome: "error",
    runId: "",
    turns: 0,
    toolCalls: 0,
    toolErrors: 0,
    recoveredToolCalls: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
    costUsd: null,
    wallMs: 0,
    ttftMs: null,
    graderMs: 0,
    graderTail: "",
    changedFiles: [],
    diffStat: "",
    prefillTps: null,
    decodeTps: null,
    gpuUtilAvg: null,
    energyJ: null,
    contextWindow: 0,
    error,
  };
}
