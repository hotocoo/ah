import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

export async function exec(command: string, ctx: Pick<ToolContext, "root" | "signal" | "env" | "shellPrefix">, timeoutMs: number): Promise<ExecResult> {
  const start = performance.now();
  const argv = ctx.shellPrefix ? [...ctx.shellPrefix, "sh", "-c", command] : ["sh", "-c", command];
  const proc = Bun.spawn(argv, {
    cwd: ctx.root,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, ...ctx.env, CI: "1", NO_COLOR: "1", TERM: "dumb" },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  const onAbort = () => proc.kill("SIGKILL");
  ctx.signal?.addEventListener("abort", onAbort);
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(timer);
  ctx.signal?.removeEventListener("abort", onAbort);
  return { stdout, stderr, code: timedOut ? null : code, timedOut, durationMs: performance.now() - start };
}

const formatExec = (r: ExecResult) => {
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
        timeout_ms: { type: "integer", minimum: 1000, maximum: 600000 },
      },
      required: ["command"],
    },
  },
  summarize: (i) => `$ ${i.command}`,
  async run(input, ctx) {
    const command = str(input, "command");
    const r = await exec(command, ctx, num(input, "timeout_ms", ctx.bashTimeoutMs));
    return { content: formatExec(r), isError: r.timedOut || r.code !== 0 };
  },
};

// Detects the project's test command from manifest files.
export function detectTestCommand(root: string): string | null {
  const has = (f: string) => existsSync(join(root, f));
  if (has("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      const runner = has("bun.lock") || has("bun.lockb") ? "bun" : has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
      if (pkg.scripts?.test) return runner === "bun" ? "bun run test" : `${runner} test`;
      if (runner === "bun") return "bun test";
    } catch {
      /* fall through */
    }
  }
  if (has("Cargo.toml")) return "cargo test";
  if (has("go.mod")) return "go test ./...";
  if (has("pyproject.toml") || has("pytest.ini") || has("setup.py")) return "python -m pytest -q";
  if (has("Makefile")) return "make test";
  // No manifest: infer from test files present and runners installed.
  const files = new Bun.Glob("**/*.{test,spec}.{ts,tsx,js,mjs}").scanSync({ cwd: root, onlyFiles: true });
  if (!files.next().done && Bun.which("bun")) return "bun test";
  const py = new Bun.Glob("**/test_*.py").scanSync({ cwd: root, onlyFiles: true });
  if (!py.next().done) return "python -m pytest -q";
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
