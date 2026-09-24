#!/usr/bin/env bun
// Fills turns/tools/tokens into an external-harness bench run that ran without --agent-stats,
// then re-renders summary.json and report.md.
//   bun scripts/bench-backfill-stats.ts <run dir> '<stats cmd with {dir}>'
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { markdownReport, summarizeRun } from "../src/bench/report.ts";
import type { BenchRun } from "../src/bench/runner.ts";
import { shellQuote } from "../src/bench/runner.ts";

const [dirArg, cmd] = process.argv.slice(2);
if (!dirArg || !cmd) {
  process.stderr.write("usage: bun scripts/bench-backfill-stats.ts <run dir> '<stats cmd with {dir}>'\n");
  process.exit(2);
}
const dir = resolve(dirArg);
const run = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as BenchRun;
let filled = 0;
for (const r of run.results) {
  const trialDir = join(dir, "work", r.taskId, String(r.trial));
  const p = Bun.spawnSync(["sh", "-c", cmd.replaceAll("{dir}", shellQuote(trialDir))], { stdout: "pipe", stderr: "inherit" });
  const line = p.stdout.toString().trim().split("\n").at(-1) ?? "";
  let s: { turns?: number; toolCalls?: number; toolErrors?: number; inputTokens?: number; outputTokens?: number } = {};
  try {
    s = JSON.parse(line);
  } catch {
    continue;
  }
  if (s.turns === undefined) continue;
  Object.assign(r, {
    turns: s.turns,
    toolCalls: s.toolCalls ?? 0,
    toolErrors: s.toolErrors ?? 0,
    usage: { ...r.usage, inputTokens: s.inputTokens ?? 0, outputTokens: s.outputTokens ?? 0 },
    measured: true,
  });
  filled++;
}
writeFileSync(join(dir, "results.json"), JSON.stringify(run, null, 2));
const summary = summarizeRun(run);
writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(dir, "report.md"), markdownReport(run, summary));
process.stdout.write(`filled ${filled}/${run.results.length} trials in ${dir}\n`);
