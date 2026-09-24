import { ToolError } from "./types.ts";

// Exact-string edits with a tolerant fallback. Local models often get indentation or
// trailing whitespace wrong in old_string (2 vs 4 spaces, tabs); an exact-only matcher
// turns every such slip into a failed tool call and a wasted turn.

export interface EditResult {
  text: string;
  strategy: "exact" | "whitespace" | "prefix";
}

// Shorter new_strings match by accident ("z" in "size").
const MIN_APPLIED_CHARS = 10;
const LINE_NO = /^\s*\d+\t/;
const allNumbered = (s: string) => {
  const lines = s.split("\n").filter((l) => l.trim() !== "");
  return lines.length > 0 && lines.every((l) => LINE_NO.test(l));
};
const stripNumbers = (s: string) => s.split("\n").map((l) => l.replace(LINE_NO, "")).join("\n");

// old_string copied with read_file's "N\t" line prefixes, or with a stray ">" quote marker.
function stripCopied(oldStr: string, newStr: string): [string, string] | null {
  if (allNumbered(oldStr)) return [stripNumbers(oldStr), allNumbered(newStr) ? stripNumbers(newStr) : newStr];
  if (/^>+ ?/.test(oldStr)) return [oldStr.replace(/^>+ ?/, ""), newStr.replace(/^>+ ?/, "")];
  return null;
}

const indentOf = (l: string) => l.match(/^[ \t]*/)![0];
const norm = (l: string) => l.trim();

// Finds windows of file lines equal to the old lines after trimming each line.
function flexibleMatches(fileLines: string[], oldLines: string[]): number[] {
  const hits: number[] = [];
  const target = oldLines.map(norm);
  if (!target.some((l) => l !== "")) return hits;
  outer: for (let i = 0; i + target.length <= fileLines.length; i++) {
    for (let j = 0; j < target.length; j++) if (norm(fileLines[i + j]!) !== target[j]) continue outer;
    hits.push(i);
  }
  return hits;
}

// Re-indents new_string so it sits at the file's real indentation: the indent the
// model used on the first old line is replaced by the file's indent on every line.
function reindent(newLines: string[], modelIndent: string, fileIndent: string): string[] {
  return newLines.map((l) => {
    if (l.trim() === "") return l.trim();
    if (modelIndent && l.startsWith(modelIndent)) return fileIndent + l.slice(modelIndent.length);
    if (!modelIndent) return fileIndent + l;
    // Line indented less than the model's base indent: keep its relative shape.
    return fileIndent + l.trimStart();
  });
}

// Up to 3 file lines resembling the first non-empty old line, for the error message.
export function nearestLines(text: string, oldStr: string): string[] {
  const first = oldStr.split("\n").map(norm).find((l) => l !== "");
  if (!first) return [];
  const words = first.split(/\W+/).filter((w) => w.length > 2);
  const scored = text
    .split("\n")
    .map((l, i) => ({ i, l, score: words.filter((w) => l.includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return scored.map((x) => `${x.i + 1}: ${JSON.stringify(x.l)}`);
}

// onInexact: called instead of the exact-only error, e.g. to ask for a read of an unread file.
export function applyEditTolerant(text: string, oldStr: string, newStr: string, replaceAll: boolean, exactOnly = false, onInexact?: () => never): EditResult {
  if (oldStr === "") throw new ToolError("old_string must not be empty");
  if (oldStr === newStr) throw new ToolError("old_string and new_string are identical");
  const crlf = text.includes("\r\n");
  const src = crlf ? text.replace(/\r\n/g, "\n") : text;
  const oldN = oldStr.replace(/\r\n/g, "\n");
  const newN = newStr.replace(/\r\n/g, "\n");
  const restore = (s: string) => (crlf ? s.replace(/\n/g, "\r\n") : s);

  const count = src.split(oldN).length - 1;
  if (count === 1 || (count > 1 && replaceAll))
    return { text: restore(replaceAll ? src.split(oldN).join(newN) : src.replace(oldN, () => newN)), strategy: "exact" };
  if (count > 1) throw new ToolError(`old_string matches ${count} times; add surrounding context or set replace_all`);

  if (onInexact) onInexact();
  if (exactOnly) throw new ToolError("old_string not found; re-read the file and copy the exact text including whitespace");
  const cleaned = stripCopied(oldN, newN);
  if (cleaned && cleaned[0].trim() !== "" && cleaned[0] !== cleaned[1]) {
    try {
      return { text: applyEditTolerant(text, cleaned[0], cleaned[1], replaceAll).text, strategy: "prefix" };
    } catch {
      // Fall through to the whitespace-tolerant match on the original text.
    }
  }
  // Fallback: line-by-line match ignoring leading/trailing whitespace.
  const fileLines = src.split("\n");
  const oldLines = oldN.replace(/\n$/, "").split("\n");
  const hits = flexibleMatches(fileLines, oldLines);
  if (hits.length === 0) {
    if (newN.trim().length >= MIN_APPLIED_CHARS && src.includes(newN))
      throw new ToolError("old_string not found, but the file already contains new_string: the edit looks already applied. Re-read the file before editing again.");
    const near = nearestLines(src, oldN);
    throw new ToolError(`old_string not found; re-read the file and copy the exact text.${near.length ? ` Closest lines:\n${near.join("\n")}` : ""}`);
  }
  if (hits.length > 1 && !replaceAll) throw new ToolError(`old_string matches ${hits.length} places (ignoring whitespace); add surrounding context or set replace_all`);
  const firstOld = oldLines.find((l) => l.trim() !== "") ?? "";
  const newLines = newN.replace(/\n$/, "").split("\n");
  let out = fileLines;
  // Apply from the last hit backwards so earlier indices stay valid.
  for (const at of [...hits].reverse()) {
    const firstFile = out.slice(at, at + oldLines.length).find((l) => l.trim() !== "") ?? "";
    const replacement = reindent(newLines, indentOf(firstOld), indentOf(firstFile));
    out = [...out.slice(0, at), ...replacement, ...out.slice(at + oldLines.length)];
  }
  return { text: restore(out.join("\n")), strategy: "whitespace" };
}
