import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ImageBlock, ToolSpec } from "../core/types.ts";

export interface ToolOutput {
  content: string;
  isError?: boolean;
  images?: ImageBlock[];
  // Files the tool created or modified, relative to the workspace root.
  changedFiles?: string[];
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export type ApprovalFn = (tool: string, input: Record<string, unknown>, summary: string) => Promise<boolean>;

export interface MediaServices {
  generateImage?(prompt: string, opts: { size?: string; model?: string }): Promise<{ mediaType: string; data: string }[]>;
  generate3d?(prompt: string, opts: { format?: string; model?: string }): Promise<{ data: Buffer; format: string; preview?: string }>;
}

export interface ToolContext {
  root: string; // workspace root; all paths are confined here
  signal?: AbortSignal;
  bashTimeoutMs: number;
  todos: TodoItem[];
  readFiles: Set<string>; // absolute paths read this session (edit-before-read guard)
  media: MediaServices;
  exactEdits?: boolean; // disable indentation-tolerant matching (ablation)
  env?: Record<string, string>;
  // Optional container runner: when set, shell commands execute through it (bench docker sandbox).
  shellPrefix?: string[];
}

export interface Tool {
  spec: ToolSpec;
  readOnly: boolean;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>;
  // One-line human summary for approval prompts and telemetry.
  summarize?(input: Record<string, unknown>): string;
  // Whether the tool can work in this context (backend configured, repo present...).
  // Unavailable tools are not offered to the model at all.
  available?(ctx: ToolContext): boolean;
  // Omitted from the compact tool profile used for small context windows.
  optional?: boolean;
}

export class ToolError extends Error {}

// Resolves a model-supplied path inside the workspace root. Rejects `..` escapes,
// absolute paths outside root and symlinks that point outside root.
export function confine(root: string, p: unknown): string {
  if (typeof p !== "string" || p === "") throw new ToolError("path must be a non-empty string");
  const absRoot = resolve(root);
  const target = resolve(absRoot, p);
  const rel = relative(absRoot, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new ToolError(`path escapes workspace: ${p}`);
  // Canonicalise the deepest existing ancestor to catch symlink escapes.
  let probe = target;
  for (;;) {
    try {
      const real = realpathSync(probe);
      const realRoot = realpathSync(absRoot);
      const r = relative(realRoot, real);
      if (r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r)) throw new ToolError(`path escapes workspace via symlink: ${p}`);
      break;
    } catch (err) {
      if (err instanceof ToolError) throw err;
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return target;
}

export const rel = (root: string, abs: string) => relative(resolve(root), abs) || ".";

export function str(input: Record<string, unknown>, key: string, required = true): string {
  const v = input[key];
  if (v === undefined || v === null) {
    if (required) throw new ToolError(`missing required parameter: ${key}`);
    return "";
  }
  if (typeof v !== "string") throw new ToolError(`parameter ${key} must be a string`);
  return v;
}

export function num(input: Record<string, unknown>, key: string, fallback: number): number {
  const v = input[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ToolError(`parameter ${key} must be a number`);
  return v;
}

export const MAX_OUTPUT_CHARS = 30_000;

export function truncate(s: string, max = MAX_OUTPUT_CHARS): string {
  if (s.length <= max) return s;
  const head = s.slice(0, Math.floor(max * 0.6));
  const tail = s.slice(-Math.floor(max * 0.3));
  return `${head}\n\n[... ${s.length - head.length - tail.length} chars truncated ...]\n\n${tail}`;
}
