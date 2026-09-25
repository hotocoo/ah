#!/usr/bin/env bun
import { sandboxKind } from "../tools/sandbox.ts";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { buildEnvironment, createSession, autoSelectModel, type Environment } from "../app/session.ts";
import { runtimeBinaries } from "../runtimes/discover.ts";
import { sampleHardware } from "../runtimes/hardware.ts";
import { bold, cyan, dim, green, red, terminalRenderer, yellow } from "./render.ts";
import type { ApprovalFn } from "../tools/types.ts";
import { COMMAND_HELP, runCommand } from "../agent/commands.ts";

export const VERSION = "0.1.0";

const HELP = `${bold("ah")} — Aletheia Harness: a local-first coding agent

Usage:
  ah run [options] "<task>"     Run a coding task to completion in the current directory
  ah chat [options]             Interactive session
  ah doctor                     Show discovered runtimes, models, hardware
  ah models [query] [filters]   Search the model catalog (local + optional cloud)
  ah bench <subcommand>         Benchmarks (see: ah bench --help)
  ah telemetry [options]        Telemetry summaries
  ah image "<prompt>" -o file   Generate an image with a discovered image backend
  ah 3d "<prompt>" -o file.glb  Generate a 3D model
  ah serve [--port N] [--no-open] Web app at http://127.0.0.1:4747/ (opens your browser)
  ah memory [list|search|add|rm] Persistent memory (verified lessons, notes, episodes)
  ah mcp                        Connect configured MCP servers and list their tools
  ah plugins                    Plugins and skills that load in this workspace
  ah trust [dir] [--remove]     Allow a workspace's own MCP servers, plugins and skills

Common options:
  -m, --model provider/model    Model (default: config, else auto-selected local model)
  --param KEY=VALUE             Request-body field for every model call, repeatable; KEY may be dotted
                                (options.num_gpu=40), VALUE is JSON when it parses (top_k=40, stop=["x"]),
                                null removes a field the harness would send
  -p, --preset NAME             Named bundle from "presets" in config (model, mode, turns, instructions)
  -C, --cwd DIR                 Workspace root (default: current directory)
  --yes                         Auto-approve writes (permission mode "auto")
  --read-only                   Only read tools
  --max-turns N                 Turn limit
  --budget USD                  Stop when spend exceeds USD (cloud models)
  --goal CONDITION              Keep working until an independent check says CONDITION holds
  -v, --verbose                 Per-turn stats and reasoning
  --json                        Emit events as JSON lines

Chat commands (ah chat, web console):
${COMMAND_HELP.replace(/^/gm, "  ")}
`;

// "a" allows the tool for the rest of the session (e.g. a run of desktop actions).
function askApproval(): ApprovalFn {
  const always = new Set<string>();
  return async (tool, _input, summary) => {
    if (always.has(tool)) return true;
    if (!process.stdin.isTTY) return false;
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const a = (await rl.question(yellow(`  allow ${summary}? [y/N/a=always ${tool}] `))).trim().toLowerCase();
    rl.close();
    if (a === "a" || a === "always") always.add(tool);
    return a === "y" || a === "yes" || always.has(tool);
  };
}

// "a.b=1" -> { a: { b: 1 } }; values are JSON when they parse, else strings.
export function parseParams(items?: string[]): Record<string, unknown> | undefined {
  if (!items?.length) return undefined;
  const out: Record<string, unknown> = {};
  for (const item of items) {
    const eq = item.indexOf("=");
    if (eq <= 0) throw new Error(`--param expects KEY=VALUE, got "${item}"`);
    const raw = item.slice(eq + 1);
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      // Plain string.
    }
    const path = item.slice(0, eq).split(".");
    let node = out;
    for (const k of path.slice(0, -1)) node = (node[k] ??= {}) as Record<string, unknown>;
    node[path.at(-1)!] = value;
  }
  return out;
}

function common(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string", short: "m" },
      preset: { type: "string", short: "p" },
      param: { type: "string", multiple: true },
      cwd: { type: "string", short: "C" },
      yes: { type: "boolean" },
      "read-only": { type: "boolean" },
      "max-turns": { type: "string" },
      budget: { type: "string" },
      goal: { type: "string" },
      verbose: { type: "boolean", short: "v" },
      json: { type: "boolean" },
      offline: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
  });
}

async function cmdRun(argv: string[], interactive: boolean): Promise<number> {
  const { values: v, positionals } = common(argv);
  const root = (v.cwd as string | undefined) ?? process.cwd();
  const env = await buildEnvironment({ cwd: root, offline: Boolean(v.offline) });
  const ac = new AbortController();
  process.on("SIGINT", () => ac.abort());
  const s = await createSession(env, {
    model: v.model as string | undefined,
    preset: v.preset as string | undefined,
    params: parseParams(v.param as string[] | undefined),
    root,
    mode: v["read-only"] ? "read-only" : v.yes ? "auto" : undefined,
    approve: askApproval(),
    maxTurns: v["max-turns"] ? Number(v["max-turns"]) : undefined,
    budgetUsd: v.budget ? Number(v.budget) : undefined,
    onEvent: terminalRenderer({ verbose: Boolean(v.verbose), json: Boolean(v.json) }),
    signal: ac.signal,
  });
  if (!v.json) {
    const g = s.generation;
    const samp = [g.temperature !== undefined ? `temp ${g.temperature}` : "", g.sampling?.topP !== undefined ? `top_p ${g.sampling.topP}` : "", g.sampling?.topK !== undefined ? `top_k ${g.sampling.topK}` : "", g.templateKwargs ? `template ${JSON.stringify(g.templateKwargs)}` : "", g.params ? `params ${JSON.stringify(g.params)}` : ""].filter(Boolean).join(" ");
    process.stderr.write(dim(`context window ${s.context.window} (${s.context.reason}) · tools ${s.toolProtocol}${s.compactTools ? " compact" : ""} · mode ${v["read-only"] ? "read-only" : v.yes ? "auto" : env.cfg.permissionMode} · shell ${env.cfg.shellSandbox === "off" ? "unconfined (shellSandbox off)" : (sandboxKind() ?? "unconfined (no OS sandbox found)")}\nsampling: ${samp || "runtime defaults"} (${g.source})\n`));
  }
  let code = 0;
  if (!interactive) {
    const task = positionals.join(" ").trim();
    if (!task) {
      process.stderr.write(red('usage: ah run "<task>"\n'));
      return 2;
    }
    if (v.goal) s.agent.setGoal(v.goal as string);
    const r = await s.agent.run(task);
    code = r.outcome === "completed" ? 0 : 1;
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    for (;;) {
      const line = (await rl.question(bold("\n› "))).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      const host = { agent: s.agent, root, run: (p: string) => s.agent.run(p), print: (t: string) => process.stdout.write(`${t}\n`), signal: ac.signal };
      if (!(await runCommand(line, host).catch((err) => (process.stderr.write(red(`  ${(err as Error).message}\n`)), true)))) await s.agent.run(line);
    }
    rl.close();
  }
  await env.telemetry.flush();
  return code;
}

const gb = (b?: number) => (b === undefined ? "-" : `${(b / 1024 ** 3).toFixed(1)} GB`);

async function cmdDoctor(argv: string[]): Promise<number> {
  const { values: v } = common(argv);
  const env = await buildEnvironment({ offline: Boolean(v.offline) });
  const hw = await sampleHardware();
  const out: string[] = [];
  out.push(bold("Hardware"));
  out.push(`  ${hw.gpuName ?? "GPU: unknown"} · ${hw.cpuCount} CPU threads · memory ${gb(hw.memTotalBytes)} (free ${gb(hw.memFreeBytes)})`);
  if (hw.gpuUtilPct !== undefined) out.push(`  GPU util ${hw.gpuUtilPct}% · GPU-allocated ${gb(hw.gpuAllocBytes)}`);
  out.push(bold("\nRuntimes"));
  if (!env.runtimes.length) out.push(yellow("  none discovered"));
  for (const [key, r] of env.registry.runtimes) {
    out.push(`  ${green(key)}  ${r.product ? `${r.product} ${dim(`(${r.kind} API)`)}` : r.kind} ${r.version ?? ""} ${dim(r.baseURL)} ${dim(`(${r.source})`)}`);
    for (const m of r.models.slice(0, 20)) out.push(`    - ${m}`);
    if (typeof r.meta.nCtx === "number") out.push(dim(`    n_ctx ${r.meta.nCtx} · tool template ${r.meta.hasToolTemplate ? "yes" : "no"}`));
  }
  const bins = runtimeBinaries(["ollama", "llama-server", "mlx_lm.server", "lms", "vllm", "comfy", "sd-server", "macmon"]);
  out.push(bold("\nRuntime binaries on PATH"));
  out.push(`  ${Object.keys(bins).join(", ") || "none"}`);
  out.push(bold("\nProviders"));
  out.push(`  ${env.registry.list().map((p) => p.key).join(", ")}`);
  out.push(bold("\nModels"));
  out.push(`  catalog: ${env.catalog.all().length} models${env.catalog.errors.length ? yellow(` (${env.catalog.errors.join("; ")})`) : ""}`);
  out.push(`  default: ${cyan(env.cfg.defaultModel ?? autoSelectModel(env) ?? "none")}${env.cfg.defaultModel ? "" : dim(" (auto-selected)")}`);
  process.stdout.write(`${out.join("\n")}\n`);
  return 0;
}

async function cmdModels(argv: string[]): Promise<number> {
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      kind: { type: "string" },
      provider: { type: "string" },
      input: { type: "string" },
      output: { type: "string" },
      tools: { type: "boolean" },
      local: { type: "boolean" },
      "min-context": { type: "string" },
      sort: { type: "string" },
      limit: { type: "string" },
      refresh: { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  const env = await buildEnvironment({});
  if (v.refresh) await env.catalog.load({ live: true, refresh: true });
  let ms = env.catalog.search({
    text: positionals.join(" ") || undefined,
    kind: v.kind as never,
    provider: v.provider as string | undefined,
    input: v.input as never,
    output: v.output as never,
    toolCall: v.tools ? true : undefined,
    minContext: v["min-context"] ? Number(v["min-context"]) : undefined,
    providers: v.local ? [...env.registry.runtimes.keys()] : undefined,
    sort: (v.sort as never) ?? "name",
    limit: Number(v.limit ?? 50),
  });
  if (v.json) {
    process.stdout.write(`${JSON.stringify(ms, null, 2)}\n`);
    return 0;
  }
  for (const m of ms) {
    const cost = m.cost?.input !== undefined ? `$${m.cost.input}/$${m.cost.output ?? "?"}` : "";
    const local = env.registry.runtimes.has(m.provider) ? green(" local") : "";
    process.stdout.write(
      `${cyan(`${m.provider}/${m.id}`)}${local}  ${dim([m.kinds.join(","), m.contextWindow ? `${m.contextWindow} ctx` : "", m.toolCall ? "tools" : "", m.inputModalities.join("+") + "→" + m.outputModalities.join("+"), cost, m.local?.quantization ?? ""].filter(Boolean).join(" · "))}\n`,
    );
  }
  return 0;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "run":
      return cmdRun(rest, false);
    case "chat":
      return cmdRun(rest, true);
    case "doctor":
      return cmdDoctor(rest);
    case "models":
      return cmdModels(rest);
    case "bench":
      return (await import("./bench-cmd.ts")).cmdBench(rest);
    case "telemetry":
      return (await import("./telemetry-cmd.ts")).cmdTelemetry(rest);
    case "image":
    case "3d":
      return (await import("./media-cmd.ts")).cmdMedia(cmd, rest);
    case "memory":
    case "mcp":
    case "plugins":
    case "trust": {
      const m = await import("./ext-cmd.ts");
      return { memory: m.cmdMemory, mcp: m.cmdMcp, plugins: m.cmdPlugins, trust: m.cmdTrust }[cmd](rest);
    }
    case "serve":
      return (await import("../server/server.ts")).cmdServe(rest);
    case "--version":
    case "-V":
      process.stdout.write(`ah ${VERSION}\n`);
      return 0;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return 0;
    default:
      // `ah "task"` is shorthand for `ah run "task"`.
      return cmdRun(argv, false);
  }
}

export type { Environment };

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(red(`ah: ${(err as Error).message}\n`));
      process.exit(1);
    },
  );
}
