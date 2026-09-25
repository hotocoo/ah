import { existsSync, readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { numbered } from "../tools/fs.ts";
import { confine } from "../tools/types.ts";

// `@path` in a task attaches that file, so the model starts with its content instead of
// spending a turn on read_file. Only real files inside the workspace, and only a few small ones.
const MENTION = /(?:^|\s)@([\w./-]*[\w/-])/g;
const MAX_FILES = 5;
const MAX_BYTES = 60_000;
const MAX_LINES = 2000;

export interface Attachment {
  path: string;
  abs: string;
  text: string; // numbered like read_file output
}

export function mentionedFiles(root: string, prompt: string): Attachment[] {
  const out: Attachment[] = [];
  for (const m of prompt.matchAll(MENTION)) {
    if (out.length >= MAX_FILES) break;
    let abs: string;
    try {
      abs = confine(root, m[1]!);
    } catch {
      continue;
    }
    if (out.some((a) => a.abs === abs) || !existsSync(abs)) continue;
    const st = statSync(abs);
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    const buf = readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) continue;
    const lines = buf.toString("utf8").split("\n").slice(0, MAX_LINES);
    out.push({ path: relative(root, abs), abs, text: numbered(lines, 1) });
  }
  return out;
}
