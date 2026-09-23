import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildEnvironment, createSession, autoSelectModel, type SessionFeatures } from "../app/session.ts";
import { parseModelRef } from "../config.ts";
import { compareRuns, markdownComparison, markdownReport, summarizeRun } from "../bench/report.ts";
import { runBench, type BenchRun } from "../bench/runner.ts";
import { loadSuite } from "../bench/task.ts";
import { measureThroughput, throughputMarkdown } from "../bench/throughput.ts";
import { bold, cyan, dim, green, red, yellow } from "./render.ts";
import { assetDir } from "../app/paths.ts";

const HELP = `ah bench — benchmarks

  ah bench run [--suite DIR] [--model p/m] [--trials N] [--task ID]... [--tag T]... [--out DIR]
               [--baseline] [--no-context-sizing] [--no-text-tools] [--no-compact] [--protocol native|text]
      Agentic coding suite. Each trial runs in a fresh sandbox; hidden graders decide pass/fail.
      --baseline switches off ah's local-model adaptations (for ablation).
  ah bench throughput [--model p/m] [--sizes 512,2048,8192] [--gen 128] [--trials 3] [--out DIR]
      Serving-path TTFT / prefill / decode measurements.
  ah bench compare <baseline/results.json> <candidate/results.json>
      Per-task pass-rate deltas with Wilson 95% significance.
  ah bench list [--suite DIR]
`;

const DEFAULT_SUITE = assetDir("bench/suites/core") ?? "bench/suites/core";
const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);

export async function cmdBench(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  const { values: v, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: false,
    options: {
      suite: { type: "string" },
      model: { type: "string", short: "m" },
      trials: { type: "string" },
      task: { type: "string", multiple: true },
      tag: { type: "string", multiple: true },
      out: { type: "string" },
      baseline: { type: "boolean" },
      "no-context-sizing": { type: "boolean" },
      "no-text-tools": { type: "boolean" },
      "no-compact": { type: "boolean" },
      protocol: { type: "string" },
      keep: { type: "boolean" },
      sizes: { type: "string" },
      gen: { type: "string" },
      verbose: { type: "boolean", short: "v" },
    },
  });
  const suiteDir = (v.suite as string | undefined) ?? DEFAULT_SUITE;

  if (sub === "list") {
    for (const t of loadSuite(suiteDir)) process.stdout.write(`${cyan(t.id)}  ${dim(`${t.language ?? ""} · ${t.category} · difficulty ${t.difficulty}`)}\n  ${t.name}\n`);
    return 0;
  }

  if (sub === "compare") {
    const [a, b] = positionals;
    if (!a || !b) {
      process.stderr.write(HELP);
      return 2;
    }
    const ra = JSON.parse(readFileSync(a, "utf8")) as BenchRun;
    const rb = JSON.parse(readFileSync(b, "utf8")) as BenchRun;
    process.stdout.write(markdownComparison(`A: ${ra.model}`, `B: ${rb.model}`, compareRuns(ra, rb)));
    return 0;
  }

  if (sub === "run" || sub === "throughput") {
    const env = await buildEnvironment({});
    const model = (v.model as string | undefined) ?? env.cfg.defaultModel ?? autoSelectModel(env);
    if (!model) {
      process.stderr.write(red("no model: pass --model provider/model (see `ah doctor`)\n"));
      return 2;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const out = resolve((v.out as string | undefined) ?? join(env.cfg.dataDir, "bench", `${stamp}_${slug(model)}`));
    mkdirSync(out, { recursive: true });

    if (sub === "throughput") {
      const { provider, model: id } = parseModelRef(model);
      const sizes = String(v.sizes ?? "512,2048,8192").split(",").map(Number);
      const gen = Number(v.gen ?? 128);
      // Reuse the agent's context decision so the runtime is not reloaded between modes.
      const s = await createSession(env, { model, root: process.cwd() });
      process.stderr.write(dim(`throughput ${model} · context ${s.context.window} · sizes ${sizes.join(",")} · gen ${gen}\n`));
      const r = await measureThroughput(env.registry.get(provider), id, {
        promptSizes: sizes,
        genTokens: gen,
        trials: Number(v.trials ?? 3),
        contextWindow: s.context.window,
        onPoint: (p) =>
          process.stderr.write(dim(`  ${p.promptTokensTarget} #${p.trial}: ttft ${p.ttftMs?.toFixed(0)}ms prefill ${p.prefillTps?.toFixed(1)} decode ${p.decodeTps?.toFixed(1)} tok/s\n`)),
      });
      const md = throughputMarkdown(model, r.summary, gen);
      writeFileSync(join(out, "throughput.json"), JSON.stringify({ model, contextWindow: s.context.window, ...r }, null, 2));
      writeFileSync(join(out, "throughput.md"), md);
      process.stdout.write(`${md}\n${dim(`wrote ${out}`)}\n`);
      return 0;
    }

    const tasks = loadSuite(suiteDir, { ids: v.task as string[] | undefined, tags: v.tag as string[] | undefined });
    const features: SessionFeatures = v.baseline
      ? { contextSizing: false, textToolParsing: false, compactTools: false, toolProtocol: "native" }
      : {
          ...(v["no-context-sizing"] ? { contextSizing: false } : {}),
          ...(v["no-text-tools"] ? { textToolParsing: false } : {}),
          ...(v["no-compact"] ? { compactTools: false } : {}),
          ...(v.protocol ? { toolProtocol: v.protocol as "native" | "text" } : {}),
        };
    const trials = Number(v.trials ?? 3);
    const benchRunId = `bench_${stamp}_${slug(model)}${v.baseline ? "_baseline" : ""}`;
    process.stderr.write(bold(`bench ${model}`) + dim(` · ${tasks.length} tasks × ${trials} trials · ${JSON.stringify(features)} · ${out}\n`));
    const run = await runBench({
      env,
      model,
      tasks,
      trials,
      outDir: out,
      benchRunId,
      features,
      keepWorkdirs: Boolean(v.keep),
      onTrial: (r) =>
        process.stderr.write(
          `  ${r.passed ? green("PASS") : red("FAIL")} ${r.taskId} #${r.trial} ${dim(`${(r.wallMs / 1000).toFixed(1)}s · ${r.turns} turns · ${r.toolCalls} tools${r.toolErrors ? ` (${r.toolErrors} err)` : ""}${r.recoveredToolCalls ? ` · ${r.recoveredToolCalls} recovered` : ""}${r.failReason ? ` · ${r.failReason}` : ""}`)}\n`,
        ),
    });
    const summary = summarizeRun(run);
    writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
    const md = markdownReport(run, summary);
    writeFileSync(join(out, "report.md"), md);
    await env.telemetry.flush();
    const o = summary.overall;
    process.stdout.write(
      `\n${bold("result")} ${o.passes}/${o.trials} trials · pass@1 ${((o.meanPassAt1 ?? 0) * 100).toFixed(0)}% · pass^${trials} ${((o.meanPassHatK ?? 0) * 100).toFixed(0)}% · ${o.solvedAny}/${summary.tasks.length} tasks solved\n${dim(`report: ${join(out, "report.md")}`)}\n`,
    );
    if (run.skipped.length) process.stderr.write(yellow(`skipped: ${run.skipped.map((s) => `${s.taskId} (${s.reason})`).join(", ")}\n`));
    return 0;
  }

  process.stdout.write(HELP);
  return sub ? 2 : 0;
}
