import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Web console sessions on disk, so history survives a server restart: an index of summaries
// plus one file per session with its event log (for replay) and the agent's messages (to
// continue the conversation).
export interface SessionMeta {
  id: string;
  root: string;
  title: string;
  model: string;
  mode: string;
  createdAt: number;
  updatedAt: number;
  runs: number;
  lastOutcome: string | null;
}
export interface StoredSession extends SessionMeta {
  log: unknown[];
  messages: unknown[];
}

const SAFE_ID = /^[\w-]{1,80}$/;

export class SessionStore {
  constructor(private dir: string) {}

  private file(id: string): string | null {
    return SAFE_ID.test(id) ? join(this.dir, `${id}.json`) : null;
  }
  private index(): SessionMeta[] {
    try {
      return JSON.parse(readFileSync(join(this.dir, "index.json"), "utf8")) as SessionMeta[];
    } catch {
      return [];
    }
  }
  private writeAtomic(path: string, data: string) {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(`${path}.tmp`, data);
    renameSync(`${path}.tmp`, path);
  }

  list(root: string): SessionMeta[] {
    return this.index().filter((m) => m.root === root);
  }

  load(id: string): StoredSession | null {
    const f = this.file(id);
    if (!f || !existsSync(f)) return null;
    try {
      return JSON.parse(readFileSync(f, "utf8")) as StoredSession;
    } catch {
      return null;
    }
  }

  save(s: StoredSession): void {
    const f = this.file(s.id);
    if (!f) return;
    this.writeAtomic(f, JSON.stringify(s));
    const { log: _log, messages: _messages, ...meta } = s;
    this.writeAtomic(join(this.dir, "index.json"), JSON.stringify([meta, ...this.index().filter((m) => m.id !== s.id)]));
  }

  remove(id: string): void {
    const f = this.file(id);
    if (!f) return;
    rmSync(f, { force: true });
    this.writeAtomic(join(this.dir, "index.json"), JSON.stringify(this.index().filter((m) => m.id !== id)));
  }
}
