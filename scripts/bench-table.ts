#!/usr/bin/env bun
// Renders committed benchmark summaries into the README results section.
// Usage: bun scripts/bench-table.ts [examples/bench] [--write README.md]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { compareRuns, markdownComparison } from "../src/bench/report.ts";
import type { BenchSummary } from "../src/bench/report.ts";
import type { BenchRun } from "../src/bench/runner.ts";

const root = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "examples/bench";
const writeIdx = process.argv.indexOf("--write");
const target = writeIdx > 0 ? process.argv[writeIdx + 1] : undefined;

interface Entry {
  dir: string;
  run: BenchRun;
  s: BenchSummary;
}
const entries: Entry[] = [];
for (const day of existsSync(root) ? readdirSync(root).sort() : [])
  for (const d of readdirSync(join(root, day)).sort()) {
    const dir = join(root, day, d);
    if (!existsSync(join(dir, "summary.json"))) continue;
    entries.push({ dir, run: JSON.parse(readFileSync(join(dir, "results.json"), "utf8")), s: JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) });
  }

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const f1 = (x: number | null) => (x === null ? "–" : x.toFixed(1));
const sec = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(0)} s`);
const isBaseline = (e: Entry) => e.run.features && (e.run.features as { contextSizing?: boolean }).contextSizing === false && (e.run.features as { textToolParsing?: boolean }).textToolParsing === false;

const lines: string[] = [];
lines.push(`Measured on ${entries[0]?.run.hardware.gpuName ?? "?"}, ${Math.round((entries[0]?.run.hardware.memTotalBytes ?? 0) / 1024 ** 3)} GB unified memory. 8 tasks × ${entries[0]?.run.trials ?? "?"} trials per model; each trial in a fresh sandbox, graded by hidden tests.`, "");
lines.push("| model | mode | trials passed (95% CI) | pass@1 | pass^k | tasks solved ≥1× / every trial | wall p50 / trial | decode tok/s | tool calls recovered from text |");
lines.push("|---|---|---|---|---|---|---|---|---|");
for (const e of entries) {
  const o = e.s.overall;
  lines.push(
    `| \`${e.run.model}\` | ${isBaseline(e) ? "baseline (ah adaptations off)" : "ah"} | ${o.passes}/${o.trials} (${pct(o.wilson.low)}–${pct(o.wilson.high)}) | ${pct(o.meanPassAt1)} | ${pct(o.meanPassHatK)} | ${o.solvedAny} / ${o.solvedAll} of ${e.s.tasks.length} | ${sec(o.p50WallMs)} | ${f1(o.meanDecodeTps)} | ${o.recoveredToolCalls} |`,
  );
}
lines.push("", "Per task (passes / trials):", "");
const tasks = [...new Set(entries.flatMap((e) => e.s.tasks.map((t) => t.taskId)))];
lines.push(`| task | ${entries.map((e) => `\`${e.run.model.split("/").pop()}\`${isBaseline(e) ? " baseline" : ""}`).join(" | ")} |`);
lines.push(`|---|${entries.map(() => "---").join("|")}|`);
for (const id of tasks) lines.push(`| ${id} | ${entries.map((e) => { const t = e.s.tasks.find((x) => x.taskId === id); return t ? `${t.passes}/${t.n}` : "skipped"; }).join(" | ")} |`);
// Ablation: pair each baseline run with the ah run of the same model.
for (const b of entries.filter(isBaseline)) {
  const a = entries.find((e) => !isBaseline(e) && e.run.model === b.run.model);
  if (!a) continue;
  lines.push("", `Ablation on \`${b.run.model}\` (A = baseline, B = ah):`, "", markdownComparison("A: baseline", "B: ah", compareRuns(b.run, a.run)).trim());
}
lines.push("", `Reports: ${entries.map((e) => `[${e.run.model.split("/").pop()}${isBaseline(e) ? " baseline" : ""}](${relative(".", join(e.dir, "report.md"))})`).join(" · ")}`);
const md = lines.join("\n");

if (target) {
  const readme = readFileSync(target, "utf8");
  const start = "<!-- BENCH-RESULTS -->";
  const end = "<!-- /BENCH-RESULTS -->";
  const block = `${start}\n${md}\n${end}`;
  writeFileSync(target, readme.includes(end) ? readme.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block) : readme.replace(start, block));
  process.stdout.write(`updated ${target}\n`);
} else process.stdout.write(`${md}\n`);
