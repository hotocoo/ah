import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildGraph, outline, symbolReport } from "../tools/graph.ts";
import { confine } from "../tools/types.ts";
import type { RunSummary } from "./events.ts";
import type { Agent } from "./loop.ts";

// Built-in session commands, shared by the CLI chat and the web console. Each one is a thin
// layer over the agent: /goal and /verify use the independent judge, /advisor the reviewer
// model, /loop repeats runs, /graph queries the code graph without a model call.
export interface CommandHost {
  agent: Agent;
  root: string;
  run(prompt: string): Promise<RunSummary>;
  print(text: string): void;
  signal?: AbortSignal;
}

export const COMMAND_HELP = `/goal <condition>     work until an independent check says the condition holds (/goal: show, /goal clear)
/verify [criterion]   independent check of the workspace against the last task (or a criterion)
/advisor [question]   second opinion on the session so far; the advice joins the next request
/loop [every] [Nx] <task>  repeat a task: on an interval (30s, 5m, 1h) until stopped or N runs,
                      or back to back until an independent check passes (default 3 runs)
/graph [symbol|path]  code graph: outline, or a symbol's definitions, callers and calls
/help                 this list`;

const INTERVAL = /^(\d+)(s|m|h)$/;
const COUNT = /^(\d+)x$/;
const UNIT = { s: 1000, m: 60_000, h: 3_600_000 } as const;

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

// Returns false when the line is not a command (the caller runs it as a task).
export async function runCommand(line: string, h: CommandHost): Promise<boolean> {
  const m = /^\/(goal|verify|advisor|loop|graph|help)\b\s*([\s\S]*)$/.exec(line.trim());
  if (!m) return false;
  const [, cmd, rest = ""] = m;
  const arg = rest.trim();
  switch (cmd) {
    case "help":
      h.print(COMMAND_HELP);
      break;
    case "goal":
      if (!arg) h.print(h.agent.goal ? `goal: ${h.agent.goal}` : "no goal set");
      else if (arg === "clear") (h.agent.setGoal(null), h.print("goal cleared"));
      else {
        h.agent.setGoal(arg);
        await h.run(`Work toward this goal until it holds: ${arg}`);
      }
      break;
    case "verify": {
      const j = await h.agent.verify(arg || undefined);
      h.print(`${j.met ? "MET" : "NOT MET"}${j.check ? ` (\`${j.check.command}\` ${j.check.passed ? "passes" : "fails"})` : ""}\n${j.reason}`);
      break;
    }
    case "advisor": {
      const advice = await h.agent.advise(arg || undefined);
      h.print(advice);
      h.agent.steer(`[advisor] ${advice}`);
      break;
    }
    case "loop":
      await loop(arg, h);
      break;
    case "graph": {
      // A path (has a slash or names an existing entry) gets an outline; anything else is a symbol.
      const isPath = !arg || arg.includes("/") || existsSync(join(h.root, arg));
      h.print(isPath ? outline(h.root, buildGraph(confine(h.root, arg || "."))) : symbolReport(h.root, buildGraph(h.root), arg));
      break;
    }
  }
  return true;
}

async function loop(arg: string, h: CommandHost) {
  const words = arg.split(/\s+/);
  let every = 0;
  let times = 0;
  while (words.length) {
    const w = words[0]!;
    const iv = INTERVAL.exec(w);
    const n = COUNT.exec(w);
    if (iv) every = Number(iv[1]) * UNIT[iv[2] as keyof typeof UNIT];
    else if (n) times = Number(n[1]);
    else break;
    words.shift();
  }
  const task = words.join(" ").trim();
  if (!task) return h.print("usage: /loop [30s|5m|1h] [Nx] <task>");
  const max = times || (every ? Number.POSITIVE_INFINITY : 3);
  for (let i = 1; i <= max && !h.signal?.aborted; i++) {
    h.print(`loop ${i}${Number.isFinite(max) ? `/${max}` : ""}`);
    const r = await h.run(task);
    if (r.outcome === "aborted") break;
    if (every) {
      await wait(every, h.signal);
      continue;
    }
    // Self-paced: stop as soon as an independent check says the task is done.
    const j = await h.agent.verify(task);
    h.print(`loop ${i}: ${j.met ? "MET" : "NOT MET"} ${j.reason}`.trim());
    if (j.met) break;
  }
}
