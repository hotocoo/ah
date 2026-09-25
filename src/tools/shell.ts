import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { num, str, ToolError, truncate, type Tool, type ToolContext } from "./types.ts";

// Commands that are never run without explicit approval, even in auto mode.
const DANGEROUS = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/|~|\$HOME|\*)(\s|$)/i,
  /\bmkfs\b/,
  /\bdd\s+.*of=\/dev\//,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, // fork bomb
  /\bgit\s+push\s+.*--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bchmod\s+-R\s+777\s+\//,
  /\b(shutdown|reboot|halt)\b/,
  /curl[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
  /\bsudo\b/,
];

export const isDangerousCommand = (cmd: string): boolean => DANGEROUS.some((r) => r.test(cmd));

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  durationMs: number;
}

// Environment for model-run commands: the user's environment minus anything that looks
// like a credential, so a model cannot read API keys or tokens with `env`.
const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH|COOKIE|SESSION)/i;

export function scrubbedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  // SSH_AUTH_SOCK is a socket path (agent access without exposing keys), not a secret.
  for (const [k, v] of Object.entries(env)) if (v !== undefined && (!SECRET_NAME.test(k) || k === "SSH_AUTH_SOCK")) out[k] = v;
  return out;
}

// All descendants of a process (children first), via pgrep.
function descendants(pid: number): number[] {
  const r = Bun.spawnSync(["pgrep", "-P", String(pid)], { stdout: "pipe", stderr: "ignore" });
  const kids = r.stdout.toString().trim().split("\n").filter(Boolean).map(Number);
  return kids.flatMap((k) => [...descendants(k), k]);
}

// Kills a process and everything it started. Killing only the shell leaves
// grandchildren (npx -> node -> workers) holding the output pipes open.
export function killTree(pid: number): void {
  for (const p of [...descendants(pid), pid]) {
    try {
      process.kill(p, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

// Reads a stream into a string until it ends or `stop` resolves.
async function drain(stream: ReadableStream<Uint8Array>, stop: Promise<void>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  let stopped = false;
  void stop.then(() => {
    stopped = true;
    void reader.cancel().catch(() => {});
  });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || stopped) break;
      out += dec.decode(value, { stream: true });
    }
  } catch {
    /* cancelled */
  }
  return out;
}

export async function exec(command: string, ctx: Pick<ToolContext, "root" | "signal" | "env" | "shellPrefix">, timeoutMs: number): Promise<ExecResult> {
  const start = performance.now();
  const argv = ctx.shellPrefix ? [...ctx.shellPrefix, "sh", "-c", command] : ["sh", "-c", command];
  const proc = Bun.spawn(argv, {
    cwd: ctx.root,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...scrubbedEnv(process.env), ...ctx.env, CI: "1", NO_COLOR: "1", TERM: "dumb" },
  });
  let timedOut = false;
  let release!: () => void;
  // After a kill, give pipes a moment to flush, then stop waiting on them.
  const killed = new Promise<void>((r) => (release = r));
  const kill = () => {
    killTree(proc.pid);
    setTimeout(release, 1000);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutMs);
  const onAbort = () => kill();
  ctx.signal?.addEventListener("abort", onAbort);
  const exited = proc.exited.then(() => undefined);
  const [stdout, stderr] = await Promise.all([drain(proc.stdout, killed), drain(proc.stderr, killed)]);
  const code = await Promise.race([proc.exited, killed.then(() => null)]);
  clearTimeout(timer);
  release();
  void exited;
  ctx.signal?.removeEventListener("abort", onAbort);
  return { stdout, stderr, code: timedOut ? null : code, timedOut, durationMs: performance.now() - start };
}

export const formatExec = (r: ExecResult) => {
  const parts = [];
  if (r.stdout) parts.push(r.stdout.trimEnd());
  if (r.stderr) parts.push(`[stderr]\n${r.stderr.trimEnd()}`);
  parts.push(r.timedOut ? "[timed out]" : `[exit ${r.code}]`);
  return truncate(parts.join("\n"));
};

export const bashTool: Tool = {
  readOnly: false,
  spec: {
    name: "bash",
    description:
      "Run a shell command in the workspace root (non-interactive, no TTY). Use for builds, tests, git, package managers. Output is truncated to 30k chars. Avoid long-running servers; they are killed at the timeout.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        // Small models often pass seconds here; values under 1000 are read as seconds.
        timeout_ms: { type: "integer", minimum: 1, maximum: 600000 },
      },
      required: ["command"],
    },
  },
  summarize: (i) => `$ ${i.command}`,
  async run(input, ctx) {
    const command = str(input, "command");
    const t = num(input, "timeout_ms", ctx.bashTimeoutMs);
    const r = await exec(command, ctx, t < 1000 ? t * 1000 : t);
    // Name the cause, so the model does not retry a write the sandbox will always refuse.
    const note = ctx.shellPrefix && /Operation not permitted/.test(r.stderr) ? "\n[workspace-only shell: writes are allowed only inside the workspace, temp dirs and tool caches]" : "";
    return { content: formatExec(r) + note + (r.code === 127 ? missingCommandHint(r.stderr) : ""), isError: r.timedOut || r.code !== 0 };
  },
};

// A missing command usually has a versioned twin on PATH (python -> python3, pip -> pip3.14).
// Look it up instead of guessing, so the model does not burn a turn discovering it.
function versionedOnPath(cmd: string): string[] {
  const found = new Set<string>();
  const re = new RegExp(`^${cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[-.]?\\d[\\d.]*$`);
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    try {
      for (const f of readdirSync(dir)) if (re.test(f)) found.add(f);
    } catch {
      /* unreadable PATH entry */
    }
  }
  return [...found].sort((a, b) => a.length - b.length).slice(0, 3);
}
export function missingCommandHint(stderr: string): string {
  const found = [...stderr.matchAll(/command not found: ([\w.+-]+)|(?:^|[\s:])([\w.+-]+): (?:command )?not found(?!:)/g)].map((m) => m[1] ?? m[2]!);
  const cmds = [...new Set(found)].filter((c) => !["sh", "bash", "zsh", "line"].includes(c));
  const hints = cmds.map((c) => {
    const alts = versionedOnPath(c);
    return alts.length ? `\`${c}\` is not installed; use ${alts.map((a) => `\`${a}\``).join(" or ")}` : `\`${c}\` is not installed`;
  });
  return hints.length ? `\n[${hints.join("; ")}]` : "";
}

// The Python interpreter on PATH: macOS and many Linux images ship only python3.
export const pythonBin = () => (Bun.which("python") ? "python" : Bun.which("python3") ? "python3" : "python");

// Detects the project's test command from manifest files.
export function detectTestCommand(root: string): string | null {
  const has = (f: string) => existsSync(join(root, f));
  if (has("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      const runner = has("bun.lock") || has("bun.lockb") ? "bun" : has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
      if (pkg.scripts?.test) return runner === "bun" ? "bun run test" : `${runner} test`;
      // No test script: Bun's built-in runner works on any JS/TS project when installed.
      if (runner === "bun" || Bun.which("bun")) return "bun test";
    } catch {
      /* fall through */
    }
  }
  if (has("Cargo.toml")) return "cargo test";
  if (has("go.mod")) return "go test ./...";
  if (has("pyproject.toml") || has("pytest.ini") || has("setup.py")) return `${pythonBin()} -m pytest -q`;
  if (has("Makefile")) return "make test";
  // No manifest: infer from test files present and runners installed.
  const files = new Bun.Glob("**/*.{test,spec}.{ts,tsx,js,mjs}").scanSync({ cwd: root, onlyFiles: true });
  if (!files.next().done && Bun.which("bun")) return "bun test";
  const py = new Bun.Glob("**/test_*.py").scanSync({ cwd: root, onlyFiles: true });
  if (!py.next().done) return `${pythonBin()} -m pytest -q`;
  if (has("pom.xml")) return "mvn -q test";
  if (has("build.gradle") || has("build.gradle.kts")) return "./gradlew test";
  return null;
}

export const runTestsTool: Tool = {
  readOnly: false,
  spec: {
    name: "run_tests",
    description:
      "Run the project's test suite (auto-detected from package.json, Cargo.toml, go.mod, pyproject.toml, Makefile...). Pass `command` to override, `filter` to append a test name/path filter.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" }, filter: { type: "string" } },
    },
  },
  summarize: (i) => `run tests ${i.command ?? ""} ${i.filter ?? ""}`.trim(),
  async run(input, ctx) {
    const base = (input.command as string | undefined) ?? detectTestCommand(ctx.root);
    if (!base) throw new ToolError("could not detect a test command; pass `command`");
    const cmd = input.filter ? `${base} ${JSON.stringify(String(input.filter))}` : base;
    const r = await exec(cmd, ctx, Math.max(ctx.bashTimeoutMs, 300_000));
    return { content: `$ ${cmd}\n${formatExec(r)}`, isError: r.timedOut || r.code !== 0 };
  },
};
