import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { walkFiles } from "./search.ts";
import { confine, rel, truncate, type Tool } from "./types.ts";

// Language-agnostic code graph from top-level declarations: an outline per file, and for a
// symbol its definitions, callers (the declaration enclosing each reference) and callees
// (declared functions its body calls). No parser per language; declarations are lines that
// start with a declaration keyword at low indentation.
const DECL = /^\s*(export\s+)?(default\s+)?(async\s+)?(pub(\(crate\))?\s+)?(function\*?|class|interface|type|enum|struct|trait|impl|fn|def|func|const|let|module|object)\s+([A-Za-z_$][\w$]*)/;
// Methods inside a class body (two- or four-space indent, no keyword): a name, a parameter
// list (one level of nested parentheses) and an optional return type, then `{` ending the line.
// Call statements (`  helper(1)`, `  foo(a, () => {`) do not end that way. Python's `def` is DECL.
const METHOD = /^ {2}(?: {2})?(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*#?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\([^()]*(?:\([^()]*\)[^()]*)*\)\s*(?::\s*[^=;{}()]+)?\{\s*$/;
const NOT_METHOD = new Set(["if", "for", "while", "switch", "catch", "return", "function", "else", "do", "try", "with", "await", "new", "super", "this"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".rs", ".go", ".java", ".kt", ".rb", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".scala"]);
const MAX_FILE_BYTES = 1_000_000;

interface Decl {
  file: string;
  line: number; // 1-based
  end: number; // last line of its body: the line before the next declaration in the file
  kind: string;
  name: string;
}

function declaration(l: string): { kind: string; name: string } | null {
  const indent = l.search(/\S/);
  if (indent < 0 || indent > 4) return null;
  const m = l.match(DECL);
  // Variables count only at top level; indented const/let are locals.
  if (m) return (m[6] === "const" || m[6] === "let") && indent > 0 ? null : { kind: m[6]!, name: m[7]! };
  const mm = l.match(METHOD);
  return mm && !NOT_METHOD.has(mm[1]!) ? { kind: "method", name: mm[1]! } : null;
}

export interface CodeGraph {
  files: Map<string, string[]>;
  decls: Decl[];
}

// ponytail: re-scans the tree on every call (fine up to a few thousand files); cache by mtime if that gets slow.
export function buildGraph(base: string, maxFiles = 3000): CodeGraph {
  const files = new Map<string, string[]>();
  const decls: Decl[] = [];
  for (const f of walkFiles(base)) {
    if (!SOURCE_EXT.has(extname(f))) continue;
    if (files.size >= maxFiles) break;
    try {
      if (statSync(f).size > MAX_FILE_BYTES) continue;
    } catch {
      continue;
    }
    const lines = readFileSync(f, "utf8").split("\n");
    files.set(f, lines);
    const own: Decl[] = [];
    lines.forEach((l, i) => {
      const d = declaration(l);
      if (d) own.push({ file: f, line: i + 1, end: lines.length, ...d });
    });
    own.forEach((d, i) => (d.end = own[i + 1] ? own[i + 1]!.line - 1 : lines.length));
    decls.push(...own);
  }
  return { files, decls };
}

export function outline(root: string, g: CodeGraph, maxPerFile = 40): string {
  const out: string[] = [];
  for (const [f, lines] of g.files) {
    const own = g.decls.filter((d) => d.file === f);
    out.push(`${rel(root, f)} (${lines.length} lines)`);
    out.push(...own.slice(0, maxPerFile).map((d) => `  ${d.line}: ${d.kind} ${d.name}`));
    if (own.length > maxPerFile) out.push(`  ... ${own.length - maxPerFile} more`);
  }
  return out.join("\n") || "no source files";
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const enclosing = (g: CodeGraph, file: string, line: number) => g.decls.find((d) => d.file === file && d.line <= line && line <= d.end);

export function symbolReport(root: string, g: CodeGraph, symbol: string, limit = 60): string {
  const word = new RegExp(`(^|[^\\w$])${escape(symbol)}([^\\w$]|$)`);
  const defs = g.decls.filter((d) => d.name === symbol);
  const at = (d: { file: string; line: number }) => `${rel(root, d.file)}:${d.line}`;
  // Callers: every reference outside the symbol's own definitions, attributed to its enclosing declaration.
  const refs: string[] = [];
  for (const [f, lines] of g.files) {
    lines.forEach((l, i) => {
      if (!word.test(l)) return;
      const encl = enclosing(g, f, i + 1);
      if (encl?.name === symbol && defs.includes(encl)) return;
      refs.push(`  ${at({ file: f, line: i + 1 })}${encl ? ` in ${encl.kind} ${encl.name}` : ""}: ${l.trim().slice(0, 140)}`);
    });
  }
  // Callees: declared names called in the body of each definition.
  const names = new Set(g.decls.map((d) => d.name));
  const callees = new Set<string>();
  for (const d of defs) {
    const body = g.files.get(d.file)!.slice(d.line, d.end).join("\n");
    for (const m of body.matchAll(/([A-Za-z_$][\w$]+)\s*(?:<[^<>()]*>)?\(/g)) if (m[1] !== symbol && names.has(m[1]!)) callees.add(m[1]!);
  }
  const out = [
    defs.length ? `definitions:\n${defs.map((d) => `  ${at(d)} ${d.kind} ${d.name} (lines ${d.line}-${d.end})`).join("\n")}` : `definitions: none found for "${symbol}" (not a top-level declaration; references below)`,
    `references (${refs.length}):\n${refs.slice(0, limit).join("\n") || "  none"}${refs.length > limit ? `\n  ... ${refs.length - limit} more` : ""}`,
    defs.length ? `calls: ${[...callees].sort().join(", ") || "no declared symbols"}` : "",
  ];
  return out.filter(Boolean).join("\n");
}

export const graphTool: Tool = {
  readOnly: true,
  optional: true,
  spec: {
    name: "graph",
    description:
      "Code graph. Without `symbol`: outline source files under `path` (line counts, top-level declarations with line numbers); use first in an unfamiliar codebase. With `symbol`: where it is defined, every reference with the function/class it sits in (its callers), and the declared functions it calls. Use before changing a function to see what depends on it.",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, path: { type: "string" } } },
  },
  summarize: (i) => (i.symbol ? `graph ${i.symbol}` : `graph outline ${i.path ?? "."}`),
  async run(input, ctx) {
    const g = buildGraph(confine(ctx.root, (input.path as string) || "."));
    const symbol = typeof input.symbol === "string" ? input.symbol.trim() : "";
    return { content: truncate(symbol ? symbolReport(ctx.root, g, symbol) : outline(ctx.root, g)) };
  },
};
