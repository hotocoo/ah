import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compareRuns, markdownReport, summarizeRun } from "../src/bench/report.ts";
import { parseScore, type BenchRun, type TrialResult } from "../src/bench/runner.ts";
import { passAtK, passHatK, percentile, significantChange, stddev, wilson } from "../src/bench/stats.ts";
import { loadSuite, requiredBinaries } from "../src/bench/task.ts";
import { syntheticPrompt } from "../src/bench/throughput.ts";
import { exec } from "../src/tools/shell.ts";

const SUITE = resolve(import.meta.dir, "../bench/suites/core");

describe("stats", () => {
  test("pass@k unbiased estimator", () => {
    expect(passAtK(5, 0, 1)).toBe(0);
    expect(passAtK(5, 5, 1)).toBe(1);
    expect(passAtK(10, 3, 1)).toBeCloseTo(0.3);
    expect(passAtK(10, 3, 5)).toBeCloseTo(1 - 21 / 252); // 1 - C(7,5)/C(10,5)
    expect(passAtK(3, 1, 5)).toBeNull();
  });

  test("pass^k", () => {
    expect(passHatK(10, 3, 1)).toBeCloseTo(0.3);
    expect(passHatK(10, 3, 2)).toBeCloseTo(3 / 45); // C(3,2)/C(10,2)
    expect(passHatK(3, 3, 3)).toBe(1);
    expect(passHatK(3, 2, 3)).toBe(0);
  });

  test("wilson interval is sane at the extremes", () => {
    const w0 = wilson(0, 10);
    expect(w0.low).toBe(0);
    expect(w0.high).toBeGreaterThan(0.2);
    const w1 = wilson(10, 10);
    expect(w1.high).toBe(1);
    expect(w1.low).toBeLessThan(0.8);
    expect(wilson(5, 10).center).toBeCloseTo(0.5);
  });

  test("significance needs non-overlapping intervals", () => {
    expect(significantChange({ passes: 1, n: 3 }, { passes: 2, n: 3 })).toBe("same");
    expect(significantChange({ passes: 0, n: 30 }, { passes: 30, n: 30 })).toBe("better");
    expect(significantChange({ passes: 30, n: 30 }, { passes: 0, n: 30 })).toBe("worse");
  });

  test("percentile/stddev", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  test("synthetic prompts scale and are unique per nonce", () => {
    const a = syntheticPrompt(1000, "n1");
    expect(a.length).toBeGreaterThan(3500);
    expect(a).not.toBe(syntheticPrompt(1000, "n2"));
  });
});

describe("core suite", () => {
  const tasks = loadSuite(SUITE);

  test("loads 8 valid tasks with reference solutions", () => {
    expect(tasks.length).toBe(8);
    for (const t of tasks) {
      expect(t.mockScript.length).toBeGreaterThan(0);
      expect(t.grader.cmd.length).toBeGreaterThan(0);
    }
    expect(loadSuite(SUITE, { tags: ["python"] }).map((t) => t.id)).toEqual(["py-bugfix-duration"]);
  });

  // A grader that passes on the untouched fixture would make the task meaningless.
  for (const t of tasks)
    test(`grader fails on the unmodified fixture: ${t.id}`, async () => {
      const missing = requiredBinaries(t).filter((b) => !Bun.which(b));
      if (missing.length) return;
      const dir = mkdtempSync(join(tmpdir(), `ah-neg-${t.id}-`));
      try {
        cpSync(t.fixtureDir, dir, { recursive: true });
        await exec("git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm f", { root: dir }, 20_000);
        if (t.hiddenDir) cpSync(t.hiddenDir, dir, { recursive: true });
        const r = await exec(t.grader.cmd, { root: dir }, t.grader.timeoutMs);
        expect(r.code).not.toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 300_000);
});

describe("reports", () => {
  const trial = (taskId: string, n: number, passed: boolean): TrialResult => ({
    taskId,
    trial: n,
    passed,
    score: passed ? 1 : 0,
    failReason: passed ? null : "grader",
    outcome: "completed",
    runId: `r${n}`,
    turns: 3,
    toolCalls: 4,
    toolErrors: 1,
    recoveredToolCalls: 0,
    usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
    costUsd: null,
    wallMs: 1000 * n,
    ttftMs: 100,
    graderMs: 10,
    graderTail: passed ? "" : "1 fail",
    changedFiles: [],
    diffStat: "",
    prefillTps: 500,
    decodeTps: 20,
    gpuUtilAvg: null,
    energyJ: null,
    contextWindow: 32768,
  });
  const mkRun = (passes: boolean[][]): BenchRun => ({
    benchRunId: "b",
    model: "m/x",
    startedAt: "s",
    finishedAt: "f",
    trials: passes[0]!.length,
    features: {},
    hardware: { t: 0, memTotalBytes: 1, memFreeBytes: 1, load1: 0, cpuCount: 1 },
    ahVersion: "0",
    gitSha: null,
    skipped: [],
    tasks: passes.map((_, i) => ({ id: `t${i}`, name: `T${i}`, category: "c", difficulty: 1, prompt: "", grader: { cmd: "", timeoutMs: 1 }, limits: { maxTurns: 1, timeoutMs: 1 }, tags: [], mockScript: [], dir: "", fixtureDir: "" })),
    results: passes.flatMap((ps, i) => ps.map((p, j) => trial(`t${i}`, j + 1, p))),
  });

  test("summary aggregates pass@k, pass^k and solved counts", () => {
    const s = summarizeRun(mkRun([
      [true, true, true],
      [true, false, false],
      [false, false, false],
    ]));
    expect(s.overall.passes).toBe(4);
    expect(s.overall.solvedAny).toBe(2);
    expect(s.overall.solvedAll).toBe(1);
    expect(s.tasks[1]!.passAt1).toBeCloseTo(1 / 3);
    expect(s.tasks[1]!.passAtK).toBe(1);
    expect(s.tasks[1]!.passHatK).toBe(0);
    expect(s.overall.toolErrorRate).toBeCloseTo(0.25);
    const md = markdownReport(mkRun([[true, false]]), summarizeRun(mkRun([[true, false]])));
    expect(md).toContain("| trials passed | 1/2");
    expect(md).toContain("## Failed trials");
  });

  test("comparison flags only significant changes", () => {
    // 0/3 vs 3/3 is not significant at 95%; 0/10 vs 10/10 is.
    expect(compareRuns(mkRun([[false, false, false]]), mkRun([[true, true, true]])).overall.verdict).toBe("same");
    const a = mkRun([Array(10).fill(false)]);
    const b = mkRun([Array(10).fill(true)]);
    const c = compareRuns(a, b);
    expect(c.overall.delta).toBe(1);
    expect(c.overall.verdict).toBe("better");
  });
});

// Horizon tasks ship a reference solution. Grounding: the untouched fixture must fail its
// hidden grader and the reference must pass it, or the task measures nothing.
describe("horizon suite grounding", () => {
  const HORIZON = resolve(import.meta.dir, "../bench/suites/horizon");
  for (const t of loadSuite(HORIZON)) {
    const missing = requiredBinaries(t).filter((b) => !Bun.which(b));
    test.skipIf(missing.length > 0)(`${t.id}: fixture fails, reference passes`, async () => {
      const run = async (withReference: boolean) => {
        const dir = mkdtempSync(join(tmpdir(), "ah-ground-"));
        try {
          cpSync(t.fixtureDir, dir, { recursive: true });
          if (withReference) cpSync(join(t.dir, "reference"), dir, { recursive: true, force: true });
          if (t.hiddenDir) cpSync(t.hiddenDir, dir, { recursive: true, force: true });
          return await exec(t.grader.cmd, { root: dir }, t.grader.timeoutMs);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      };
      const before = await run(false);
      expect(before.code).not.toBe(0);
      const after = await run(true);
      expect(after.code).toBe(0);
      expect(parseScore(after.stdout)).toBe(1);
    }, 120_000);
  }
});

test("parseScore reads the last AH_SCORE line", () => {
  expect(parseScore("AH_SCORE 1 4\nAH_SCORE 3 4")).toBe(0.75);
  expect(parseScore("no score")).toBeNull();
  expect(parseScore("AH_SCORE 0 0")).toBeNull();
});

describe("external harness (--agent-cmd)", () => {
  test("another CLI works the same sandbox and is graded by the same hidden tests", async () => {
    const { runBench } = await import("../src/bench/runner.ts");
    const out = mkdtempSync(join(tmpdir(), "ah-ext-"));
    const tasks = loadSuite(SUITE, { ids: ["ts-bugfix-pagination"] });
    const env = { registry: { runtimes: new Map() }, telemetry: {} } as unknown as Parameters<typeof runBench>[0]["env"];
    const run = (agentCmd: string) => runBench({ env, model: "external/test", tasks, trials: 1, outDir: out, benchRunId: "t", agentCmd });
    // The prompt arrives intact through shell quoting (it contains backticks).
    const fixed = await run(`printf %s {prompt} | grep -q '\`paginate\`' && sed -i.bak 's/page \\* size/(page - 1) * size/' src/paginate.ts && rm src/paginate.ts.bak`);
    expect(fixed.results[0]!.passed).toBe(true);
    expect(fixed.results[0]!.changedFiles).toEqual(["src/paginate.ts"]);
    const noop = await run("true");
    expect(noop.results[0]!).toMatchObject({ passed: false, failReason: "grader" });
    expect(noop.results[0]!.measured).toBe(false);
    // Stats read from the harness's own records after the trial.
    const withStats = await runBench({ env, model: "external/test", tasks, trials: 1, outDir: out, benchRunId: "t", agentCmd: "true", agentStats: `echo noise; echo '{"turns":7,"toolCalls":9,"toolErrors":1,"inputTokens":1200,"outputTokens":80}'` });
    expect(withStats.results[0]!).toMatchObject({ measured: true, turns: 7, toolCalls: 9, toolErrors: 1, usage: { inputTokens: 1200, outputTokens: 80 } });
    rmSync(out, { recursive: true, force: true });
  });
});
