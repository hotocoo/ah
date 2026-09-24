import type { Database } from "bun:sqlite";

// Tool-error coaching: the harness already records every tool result per model. Error classes a
// model has hit repeatedly in past runs become up to three one-line hints in its system prompt.
// A model that never makes a mistake gets no extra tokens; a model that keeps pasting line
// numbers into old_string is told once, up front, instead of failing and retrying every run.

interface ErrorClass {
  id: string;
  match: RegExp;
  hint: string;
}

const CLASSES: ErrorClass[] = [
  { id: "copied-prefix", match: /matched after removing copied line numbers/, hint: "old_string must be the file's text only: no read_file line numbers (\"12\\t\") and no \">\" markers." },
  { id: "stale-old", match: /old_string not found; re-read/, hint: "When an edit misses, re-read the file first and copy old_string from the fresh output." },
  { id: "already-applied", match: /already contains new_string/, hint: "Check whether an edit already landed before repeating it." },
  { id: "ambiguous", match: /old_string matches \d+ (times|places)/, hint: "Make old_string unique: include a neighbouring line or two." },
  { id: "identical", match: /old_string and new_string are identical/, hint: "An edit must change something; never send identical old_string and new_string." },
  { id: "read-first", match: /before editing it/, hint: "read_file a file in this session before edit_file on it." },
  { id: "escape", match: /path escapes workspace/, hint: "Use paths relative to the workspace root; files outside it (e.g. /tmp) are not writable." },
  { id: "missing-file", match: /^file not found/, hint: "Check a path with glob or list_dir before reading it; create new files with write_file." },
];

export const MIN_OCCURRENCES = 3;
export const MIN_RUNS = 2;
const MAX_HINTS = 3;
const LOOKBACK_RUNS = 40;

export function classify(preview: string): string | null {
  return CLASSES.find((c) => c.match.test(preview))?.id ?? null;
}

// Counts error classes over the model's recent runs; a class counts once it recurs across runs.
export function coachingHints(db: Database, provider: string, model: string): string[] {
  const rows = db
    .query(
      `SELECT e.run_id, json_extract(e.data, '$.preview') preview FROM events e
       WHERE e.type = 'tool_end' AND e.run_id IN (SELECT run_id FROM runs WHERE provider = ? AND model = ? ORDER BY started_at DESC LIMIT ?)`,
    )
    .all(provider, model, LOOKBACK_RUNS) as { run_id: string; preview: string | null }[];
  const seen = new Map<string, { n: number; runs: Set<string> }>();
  for (const r of rows) {
    const id = classify(r.preview ?? "");
    if (!id) continue;
    const s = seen.get(id) ?? { n: 0, runs: new Set<string>() };
    s.n++;
    s.runs.add(r.run_id);
    seen.set(id, s);
  }
  return [...seen.entries()]
    .filter(([, s]) => s.n >= MIN_OCCURRENCES && s.runs.size >= MIN_RUNS)
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, MAX_HINTS)
    .map(([id]) => CLASSES.find((c) => c.id === id)!.hint);
}

export const renderCoaching = (hints: string[]) => (hints.length ? `Lessons from this model's earlier runs in this harness:\n${hints.map((h) => `- ${h}`).join("\n")}` : "");
