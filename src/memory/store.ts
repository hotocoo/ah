import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Where a memory came from decides how much it is trusted before any use:
// - lesson: written by the harness from a failure that later-verified evidence resolved (D25, D26)
// - note: written by the model with memory_save (a claim, not evidence)
// - episode: a compaction summary (a faithful but unverified record)
export type MemoryKind = "lesson" | "note" | "episode";

export interface Memory {
  id: number;
  scope: string; // workspace root, or "global"
  kind: MemoryKind;
  text: string;
  trust: number; // 0..1, moved by outcomes of runs that recalled the memory
  uses: number;
  wins: number;
  createdAt: number;
  sourceRun: string | null;
}

export const PRIOR_TRUST: Record<MemoryKind, number> = { lesson: 0.8, note: 0.5, episode: 0.3 };

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  trust REAL NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  source_run TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS memories_dedupe ON memories(scope, text);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(text, content='memories', content_rowid='id', tokenize='porter unicode61');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
`;

type Row = { id: number; scope: string; kind: MemoryKind; text: string; trust: number; uses: number; wins: number; created_at: number; source_run: string | null };
const toMemory = (r: Row): Memory => ({ id: r.id, scope: r.scope, kind: r.kind, text: r.text, trust: r.trust, uses: r.uses, wins: r.wins, createdAt: r.created_at, sourceRun: r.source_run });

// FTS5 query from free text: quoted terms OR-ed, so any shared word can match and
// punctuation in code identifiers never breaks the query syntax.
export function ftsQuery(text: string): string | null {
  const terms = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? [])].slice(0, 24);
  return terms.length ? terms.map((t) => `"${t}"`).join(" OR ") : null;
}

// Persistent memory: one SQLite file with full-text search. Retrieval ranks by
// relevance (bm25) weighted by trust, so memories that kept leading to verified runs
// outrank ones that did not, whatever their origin.
export class MemoryStore {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec(SCHEMA);
  }

  // Returns the id, or the existing id when the same text is already stored in the scope.
  save(m: { scope: string; kind: MemoryKind; text: string; sourceRun?: string; trust?: number }): number {
    const text = m.text.trim().slice(0, 4000);
    if (!text) throw new Error("memory text is empty");
    const existing = this.db.query("SELECT id FROM memories WHERE scope = ? AND text = ?").get(m.scope, text) as { id: number } | null;
    if (existing) return existing.id;
    const r = this.db.run("INSERT INTO memories (scope, kind, text, trust, created_at, source_run) VALUES (?, ?, ?, ?, ?, ?)", [
      m.scope,
      m.kind,
      text,
      m.trust ?? PRIOR_TRUST[m.kind],
      Date.now(),
      m.sourceRun ?? null,
    ]);
    return Number(r.lastInsertRowid);
  }

  // Scopes searched: the workspace plus global. Score = relevance x trust.
  search(query: string, scopes: string[], limit = 5, minTrust = 0.15): (Memory & { score: number })[] {
    const q = ftsQuery(query);
    if (!q || !scopes.length) return [];
    const rows = this.db
      .query(
        `SELECT m.*, bm25(memories_fts) AS rank FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
         WHERE memories_fts MATCH ? AND m.scope IN (${scopes.map(() => "?").join(",")}) AND m.trust >= ?
         ORDER BY rank LIMIT ?`,
      )
      .all(q, ...scopes, minTrust, limit * 4) as (Row & { rank: number })[];
    // bm25 is negative (lower is better); map to a positive relevance.
    return rows
      .map((r) => ({ ...toMemory(r), score: -r.rank * r.trust }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  list(scopes: string[], limit = 200): Memory[] {
    if (!scopes.length) return [];
    return (this.db.query(`SELECT * FROM memories WHERE scope IN (${scopes.map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT ?`).all(...scopes, limit) as Row[]).map(toMemory);
  }

  delete(id: number): boolean {
    return this.db.run("DELETE FROM memories WHERE id = ?", [id]).changes > 0;
  }

  // Reconsolidation: every memory recalled into a run moves toward 1 when the run
  // ended with verified evidence and toward 0 when it failed. Unverified completions
  // count as a use but move nothing (no evidence either way).
  reinforce(ids: number[], outcome: "verified" | "failed" | "unverified", rate = 0.2): void {
    for (const id of new Set(ids)) {
      if (outcome === "verified") this.db.run("UPDATE memories SET uses = uses + 1, wins = wins + 1, trust = trust + (1 - trust) * ? WHERE id = ?", [rate, id]);
      else if (outcome === "failed") this.db.run("UPDATE memories SET uses = uses + 1, trust = trust * (1 - ?) WHERE id = ?", [rate, id]);
      else this.db.run("UPDATE memories SET uses = uses + 1 WHERE id = ?", [id]);
    }
  }

  close(): void {
    this.db.close();
  }
}
