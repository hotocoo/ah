import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MockTurn } from "../providers/mock.ts";

export interface BenchTask {
  id: string;
  name: string;
  category: string;
  difficulty: number; // 1 (trivial) .. 5 (hard)
  language?: string;
  prompt: string;
  setup?: string; // shell, runs in the sandbox before the agent
  grader: { cmd: string; timeoutMs: number }; // exit 0 = pass
  limits: { maxTurns: number; timeoutMs: number; maxCostUsd?: number };
  tags: string[];
  mockScript: MockTurn[]; // scripted reference solution: proves harness plumbing, not model skill
  // Resolved at load time:
  dir: string;
  fixtureDir: string;
  hiddenDir?: string; // copied into the sandbox only after the agent finishes
}

export class TaskError extends Error {}

function validateTask(raw: unknown, dir: string): BenchTask {
  const t = raw as Partial<BenchTask>;
  const need = (cond: unknown, msg: string) => {
    if (!cond) throw new TaskError(`${dir}/task.json: ${msg}`);
  };
  need(typeof t.id === "string" && t.id, "id required");
  need(typeof t.prompt === "string" && t.prompt, "prompt required");
  need(t.grader && typeof t.grader.cmd === "string", "grader.cmd required");
  need(t.limits && typeof t.limits.maxTurns === "number", "limits.maxTurns required");
  const fixtureDir = join(dir, "fixture");
  need(existsSync(fixtureDir) && statSync(fixtureDir).isDirectory(), "fixture/ directory required");
  const hiddenDir = join(dir, "hidden");
  return {
    name: t.id!,
    category: "general",
    difficulty: 1,
    tags: [],
    mockScript: [],
    ...t,
    grader: { ...t.grader!, timeoutMs: t.grader!.timeoutMs ?? 120_000 },
    limits: { ...t.limits!, timeoutMs: t.limits!.timeoutMs ?? 600_000 },
    dir,
    fixtureDir,
    hiddenDir: existsSync(hiddenDir) ? hiddenDir : undefined,
  } as BenchTask;
}

export function loadTask(dir: string): BenchTask {
  const abs = resolve(dir);
  return validateTask(JSON.parse(readFileSync(join(abs, "task.json"), "utf8")), abs);
}

// Loads every task directory (one containing task.json) under `suiteDir`.
export function loadSuite(suiteDir: string, filter?: { ids?: string[]; tags?: string[]; categories?: string[] }): BenchTask[] {
  const abs = resolve(suiteDir);
  if (!existsSync(abs)) throw new TaskError(`suite not found: ${suiteDir}`);
  const tasks = readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(abs, d.name, "task.json")))
    .map((d) => loadTask(join(abs, d.name)))
    .sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id));
  return tasks.filter(
    (t) =>
      (!filter?.ids?.length || filter.ids.includes(t.id)) &&
      (!filter?.tags?.length || filter.tags.some((g) => t.tags.includes(g) || t.language === g)) &&
      (!filter?.categories?.length || filter.categories.includes(t.category)),
  );
}

// Tools a task needs on PATH, from its tags/language; tasks missing them are skipped.
export function requiredBinaries(t: BenchTask): string[] {
  const map: Record<string, string> = { bun: "bun", python: "python3", go: "go", rust: "cargo" };
  const need = new Set<string>();
  for (const x of [...t.tags, t.language ?? ""]) if (map[x]) need.add(map[x]);
  return [...need];
}
