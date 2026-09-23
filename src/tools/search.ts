import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { IGNORED_DIRS } from "./fs.ts";
import { confine, num, rel, str, ToolError, truncate, type Tool } from "./types.ts";

const MAX_RESULTS = 200;

export function* walkFiles(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (IGNORED_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(p);
    else if (e.isFile()) yield p;
  }
}

export const globTool: Tool = {
  readOnly: true,
  spec: {
    name: "glob",
    description: "Find files by glob pattern (e.g. `src/**/*.ts`). Results sorted by modification time, newest first.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" }, path: { type: "string", description: "Directory to search (default root)" } },
      required: ["pattern"],
    },
  },
  summarize: (i) => `glob ${i.pattern}`,
  async run(input, ctx) {
    const base = confine(ctx.root, (input.path as string) || ".");
    const g = new Bun.Glob(str(input, "pattern"));
    const hits: { p: string; m: number }[] = [];
    for (const f of walkFiles(base)) {
      const r = relative(base, f);
      if (g.match(r)) hits.push({ p: f, m: statSync(f).mtimeMs });
    }
    hits.sort((a, b) => b.m - a.m);
    const shown = hits.slice(0, MAX_RESULTS).map((h) => rel(ctx.root, h.p));
    return { content: shown.length ? shown.join("\n") + (hits.length > MAX_RESULTS ? `\n[${hits.length - MAX_RESULTS} more]` : "") : "no matches" };
  },
};

async function ripgrep(args: string[], cwd: string, signal?: AbortSignal): Promise<string | null> {
  const rg = Bun.which("rg");
  if (!rg) return null;
  const proc = Bun.spawn([rg, ...args], { cwd, stdout: "pipe", stderr: "pipe", signal });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code > 1) throw new ToolError((await new Response(proc.stderr).text()).trim() || `rg exited ${code}`);
  return out;
}

export const grepTool: Tool = {
  readOnly: true,
  spec: {
    name: "grep",
    description:
      "Search file contents with a regular expression (ripgrep syntax). Returns `path:line:text`. Use `glob` to filter files (e.g. `*.ts`), `context` for surrounding lines.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        glob: { type: "string" },
        ignore_case: { type: "boolean" },
        context: { type: "integer", minimum: 0, maximum: 10 },
        files_only: { type: "boolean", description: "Only list matching file paths" },
      },
      required: ["pattern"],
    },
  },
  summarize: (i) => `grep ${i.pattern}`,
  async run(input, ctx) {
    const pattern = str(input, "pattern");
    const base = confine(ctx.root, (input.path as string) || ".");
    const context = num(input, "context", 0);
    const args = ["--line-number", "--no-heading", "--color=never", "--max-count=50", "--hidden"];
    for (const d of IGNORED_DIRS) args.push("--glob", `!${d}`);
    if (input.ignore_case) args.push("-i");
    if (context) args.push(`-C${context}`);
    if (input.files_only) args.push("-l");
    if (typeof input.glob === "string") args.push("--glob", input.glob);
    args.push("--", pattern, relative(ctx.root, base) || ".");
    const rgOut = await ripgrep(args, ctx.root, ctx.signal);
    if (rgOut !== null) {
      const clean = rgOut.trim().replace(/^\.\//gm, "");
      return { content: clean ? truncate(clean) : "no matches" };
    }

    // Fallback: JavaScript regex over the tree.
    let re: RegExp;
    try {
      re = new RegExp(pattern, input.ignore_case ? "i" : "");
    } catch (err) {
      throw new ToolError(`invalid regex: ${(err as Error).message}`);
    }
    const g = typeof input.glob === "string" ? new Bun.Glob(input.glob) : null;
    const out: string[] = [];
    for (const f of walkFiles(base)) {
      if (g && !g.match(relative(base, f)) && !g.match(f.split("/").pop()!)) continue;
      const buf = readFileSync(f);
      if (buf.subarray(0, 8000).includes(0)) continue;
      const lines = buf.toString("utf8").split("\n");
      let fileHit = false;
      lines.forEach((l, i) => {
        if (!re.test(l) || out.length >= MAX_RESULTS) return;
        fileHit = true;
        if (!input.files_only) out.push(`${rel(ctx.root, f)}:${i + 1}:${l}`);
      });
      if (fileHit && input.files_only) out.push(rel(ctx.root, f));
    }
    return { content: out.length ? truncate(out.join("\n")) : "no matches" };
  },
};
