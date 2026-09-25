import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { applyEditTolerant } from "./edit-match.ts";
import { confine, num, rel, str, ToolError, truncate, type Tool, type ToolContext } from "./types.ts";

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const MAX_READ_LINES = 2000;
const MAX_LINE_CHARS = 2000;
const MAX_READ_CHARS = 100_000;
export const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "target", "__pycache__", ".venv", "venv", ".ah", "coverage"]);

const isBinary = (buf: Buffer) => buf.subarray(0, 8000).includes(0);

const TRANSPILE_LOADERS: Record<string, "ts" | "tsx" | "js" | "jsx"> = { ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "jsx" };

// In-process syntax check after a write (no subprocess, microseconds): a broken edit is
// reported in the same tool result instead of surfacing turns later in a test run.
export function syntaxNote(abs: string, text: string): string {
  const loader = TRANSPILE_LOADERS[extname(abs).toLowerCase()];
  if (!loader) return "";
  try {
    new Bun.Transpiler({ loader }).transformSync(text);
    return "";
  } catch (err) {
    return `\nWARNING: the file now has a syntax error: ${(err as Error).message ?? String(err)}. Fix it before continuing.`;
  }
}

// A wrong path is usually a wrong directory or extension guess. Name the likely files so the
// model does not spend a turn on list_dir or glob to find them.
const MAX_SUGGEST_SCAN = 20_000;
function notFound(root: string, path: unknown, kind: "file" | "directory" = "file"): never {
  const want = basename(String(path)).toLowerCase();
  const stem = want.replace(/\.[^.]+$/, "");
  const hits: string[] = [];
  let seen = 0;
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= 5 || ++seen > MAX_SUGGEST_SCAN) return;
      if (IGNORED_DIRS.has(e.name)) continue;
      const p = join(dir, e.name);
      const n = e.name.toLowerCase();
      if (n === want || n.replace(/\.[^.]+$/, "") === stem) hits.push(`${rel(root, p)}${e.isDirectory() ? "/" : ""}`);
      if (e.isDirectory()) walk(p);
    }
  };
  if (want) walk(root);
  throw new ToolError(`${kind} not found: ${String(path)}${hits.length ? `. Similar paths: ${hits.join(", ")}` : ". Nothing with that name exists in the workspace."}`);
}

export const numbered = (lines: string[], offset: number): string => lines.map((l, i) => `${offset + i}\t${l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)}…` : l}`).join("\n");
const NEEDS_READ_LINES = 400;

// An unread file may still be edited when old_string matches its text exactly and once (the model
// saw that text, e.g. in grep output). Otherwise the model is editing from a wrong picture of the
// file: refuse, but return the file (numbered, as read_file shows it) and count it as read, so
// the retry needs no separate read turn.
function needsRead(path: unknown, abs: string, text: string, ctx: ToolContext): never {
  ctx.readFiles.add(abs);
  const lines = text.split("\n");
  const more = lines.length > NEEDS_READ_LINES ? `\n[showing lines 1-${NEEDS_READ_LINES} of ${lines.length}; read_file with offset shows the rest]` : "";
  throw new ToolError(`old_string does not match ${String(path)} exactly, and the file had not been read in this session. Nothing was changed. Its current content:\n${truncate(numbered(lines.slice(0, NEEDS_READ_LINES), 1), 40_000)}${more}`);
}

export const readFileTool: Tool = {
  readOnly: true,
  spec: {
    name: "read_file",
    description:
      "Read a file from the workspace. Returns numbered lines (`N\\t<line>`). Use offset/limit for large files. Images are returned as image content. Always read a file before editing it.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root" },
        offset: { type: "integer", description: "1-based line to start at", minimum: 1 },
        limit: { type: "integer", description: `Max lines (default ${MAX_READ_LINES})`, minimum: 1 },
      },
      required: ["path"],
    },
  },
  summarize: (i) => `read ${i.path}`,
  async run(input, ctx) {
    const abs = confine(ctx.root, input.path);
    if (!existsSync(abs)) notFound(ctx.root, input.path);
    if (statSync(abs).isDirectory()) throw new ToolError(`${input.path} is a directory; use list_dir`);
    const imageType = IMAGE_TYPES[extname(abs).toLowerCase()];
    const buf = readFileSync(abs);
    ctx.readFiles.add(abs);
    if (imageType) return { content: `image ${input.path} (${buf.length} bytes)`, images: [{ type: "image", mediaType: imageType, data: buf.toString("base64") }] };
    if (isBinary(buf)) return { content: `binary file ${input.path} (${buf.length} bytes) not shown` };
    const lines = buf.toString("utf8").split("\n");
    const offset = num(input, "offset", 1);
    const limit = num(input, "limit", MAX_READ_LINES);
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const body = numbered(slice, offset);
    const more = offset - 1 + slice.length < lines.length ? `\n[showing lines ${offset}-${offset + slice.length - 1} of ${lines.length}]` : "";
    return { content: truncate(body || "[empty file]", MAX_READ_CHARS) + more };
  },
};

export const writeFileTool: Tool = {
  readOnly: false,
  spec: {
    name: "write_file",
    description: "Create or overwrite a file with the full given content. Prefer edit_file for changes to existing files.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string", description: "Full file contents" } },
      required: ["path", "content"],
    },
  },
  summarize: (i) => `write ${i.path} (${String(i.content ?? "").length} chars)`,
  async run(input, ctx) {
    const abs = confine(ctx.root, input.path);
    const content = str(input, "content");
    if (existsSync(abs) && !ctx.readFiles.has(abs)) throw new ToolError(`${input.path} exists; read it before overwriting`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    ctx.readFiles.add(abs);
    return { content: `wrote ${rel(ctx.root, abs)} (${content.split("\n").length} lines)${(ctx.syntaxCheck === false ? "" : syntaxNote(abs, content))}`, changedFiles: [rel(ctx.root, abs)] };
  },
};

// Applies one replacement: exact match first, then an indentation-tolerant match
// (see edit-match.ts). Requires a unique match unless replaceAll.
export function applyEdit(text: string, oldStr: string, newStr: string, replaceAll: boolean): string {
  return applyEditTolerant(text, oldStr, newStr, replaceAll).text;
}

export const editFileTool: Tool = {
  readOnly: false,
  spec: {
    name: "edit_file",
    description:
      "Replace an exact string in a file. old_string must match exactly once (include enough surrounding lines) unless replace_all is true. Do not include the line-number prefix from read_file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  summarize: (i) => `edit ${i.path}`,
  async run(input, ctx) {
    const abs = confine(ctx.root, input.path);
    if (!existsSync(abs)) notFound(ctx.root, input.path);
    const unread = !ctx.readFiles.has(abs);
    const before = readFileSync(abs, "utf8");
    const r = applyEditTolerant(before, str(input, "old_string"), str(input, "new_string"), input.replace_all === true, ctx.exactEdits, unread ? () => needsRead(input.path, abs, before, ctx) : undefined);
    ctx.readFiles.add(abs);
    writeFileSync(abs, r.text);
    const note =
      r.strategy === "whitespace"
        ? " (old_string matched ignoring indentation; new_string re-indented to the file)"
        : r.strategy === "prefix"
          ? " (old_string matched after removing copied line numbers or '>' markers; do not include them)"
          : "";
    return { content: `edited ${rel(ctx.root, abs)}${note}${(ctx.syntaxCheck === false ? "" : syntaxNote(abs, r.text))}`, changedFiles: [rel(ctx.root, abs)] };
  },
};

export const multiEditTool: Tool = {
  readOnly: false,
  optional: true,
  spec: {
    name: "multi_edit",
    description: "Apply several exact-string edits to one file atomically, in order. Fails without writing if any edit fails.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: { old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } },
            required: ["old_string", "new_string"],
          },
        },
      },
      required: ["path", "edits"],
    },
  },
  summarize: (i) => `multi-edit ${i.path} (${(i.edits as unknown[] | undefined)?.length ?? 0} edits)`,
  async run(input, ctx) {
    const abs = confine(ctx.root, input.path);
    if (!existsSync(abs)) notFound(ctx.root, input.path);
    const unread = !ctx.readFiles.has(abs);
    const edits = input.edits as { old_string: string; new_string: string; replace_all?: boolean }[];
    const original = readFileSync(abs, "utf8");
    let text = original;
    edits.forEach((e, i) => {
      try {
        text = applyEditTolerant(text, e.old_string, e.new_string, e.replace_all === true, ctx.exactEdits, unread ? () => needsRead(input.path, abs, original, ctx) : undefined).text;
      } catch (err) {
        if (unread) throw err;
        throw new ToolError(`edit ${i + 1}: ${(err as Error).message}`);
      }
    });
    writeFileSync(abs, text);
    ctx.readFiles.add(abs);
    return { content: `applied ${edits.length} edits to ${rel(ctx.root, abs)}${(ctx.syntaxCheck === false ? "" : syntaxNote(abs, text))}`, changedFiles: [rel(ctx.root, abs)] };
  },
};

export const listDirTool: Tool = {
  readOnly: true,
  spec: {
    name: "list_dir",
    description: "List a directory tree (dirs end with /). Skips .git, node_modules and build output.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Default: workspace root" }, depth: { type: "integer", minimum: 1, maximum: 6 } },
    },
  },
  summarize: (i) => `ls ${i.path ?? "."}`,
  async run(input, ctx) {
    const abs = confine(ctx.root, (input.path as string) || ".");
    if (!existsSync(abs)) notFound(ctx.root, input.path, "directory");
    const depth = num(input, "depth", 2);
    const lines: string[] = [];
    const walk = (dir: string, d: number, indent: string) => {
      if (lines.length > 500) return;
      const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (IGNORED_DIRS.has(e.name)) continue;
        lines.push(`${indent}${e.name}${e.isDirectory() ? "/" : ""}`);
        if (e.isDirectory() && d < depth) walk(join(dir, e.name), d + 1, `${indent}  `);
      }
    };
    walk(abs, 1, "");
    return { content: lines.join("\n") + (lines.length > 500 ? "\n[truncated]" : "") || "[empty]" };
  },
};
