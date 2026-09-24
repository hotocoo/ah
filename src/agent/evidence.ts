// The evidence ledger: what the harness itself observed during a run, as opposed to
// what the model says happened. It drives three things (see docs/ARCHITECTURE-NEXT.md):
//  1. the completion gate: a run that changed files may not end before a check passed;
//  2. memory admission: lessons are written only from failures that verified evidence
//     later resolved, never from the model's own account;
//  3. reconsolidation: recalled memories gain or lose trust by the run's verdict.
//
// Prediction error is implicit: an agent issues an action because it expects it to
// succeed, so every failed action is a surprise. Surprises open anomalies; an anomaly
// closes when the same kind of action later succeeds, and the actions in between are
// the candidate explanation.

export type Verdict = "verified" | "failed" | "unverified" | "none";

export interface Observation {
  name: string;
  input: Record<string, unknown>;
  summary: string;
  isError: boolean;
  denied: boolean;
  content: string;
  changedFiles: string[];
  turn: number;
}

interface Anomaly {
  key: string;
  summary: string;
  error: string;
  turn: number;
  between: string[]; // mutating actions taken while the anomaly was open
}

export interface Lesson {
  text: string;
  turn: number;
}

// Words that mark a shell command as a check (tests, builds, type checks, linters).
// Generic toolchain vocabulary, not project data: the project's own detected test
// command is added per session.
const CHECK_WORDS = /\b(test|tests|spec|build|tsc|typecheck|type-check|lint|check|vet|clippy|pytest|mypy|ruff|eslint|jest|vitest|mocha|cargo|go\s+(test|build|vet)|make|mvn|gradle|gradlew|ctest|dotnet\s+(test|build))\b/i;

const firstLine = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("$ ") && !/^exit code/i.test(l))
    ?.slice(0, 200) ?? "";

export class EvidenceLedger {
  private dirty = new Set<string>(); // files changed since the last passing check
  private everChanged = false;
  private lastCheck: { passed: boolean; turn: number; summary: string } | null = null;
  private open = new Map<string, Anomaly>();
  private resolved: Lesson[] = [];
  surprises = 0;
  checksPassed = 0;
  checksFailed = 0;

  constructor(private testCommand: string | null = null) {}

  isCheck(o: Pick<Observation, "name" | "input">): boolean {
    if (o.name === "run_tests") return true;
    if (o.name !== "bash") return false;
    const cmd = String(o.input.command ?? "");
    return CHECK_WORDS.test(cmd) || (this.testCommand !== null && cmd.includes(this.testCommand));
  }

  observe(o: Observation): void {
    if (o.denied) return;
    const check = this.isCheck(o);
    const key = check ? "check" : o.name;
    if (o.changedFiles.length) {
      this.everChanged = true;
      o.changedFiles.forEach((f) => this.dirty.add(f));
    }
    // A syntax warning after a write is a failed action even though the write succeeded.
    const failed = o.isError || /WARNING: the file now has a syntax error/.test(o.content);
    if (check) {
      this.lastCheck = { passed: !o.isError, turn: o.turn, summary: o.summary };
      if (o.isError) this.checksFailed++;
      else {
        this.checksPassed++;
        this.dirty.clear();
      }
    }
    // Mutating actions taken while another kind of action is failing are its candidate fix.
    if (!o.isError && o.changedFiles.length) for (const a of this.open.values()) if (a.key !== key && a.between.length < 6) a.between.push(o.summary);
    if (failed) {
      this.surprises++;
      const prev = this.open.get(key);
      // Keep the first failure of a streak: it is the one the fix explains.
      if (!prev) this.open.set(key, { key, summary: o.summary, error: firstLine(o.content), turn: o.turn, between: [] });
    } else {
      const a = this.open.get(key);
      if (a) {
        this.open.delete(key);
        // Only failures that took real work to fix are worth remembering; an
        // immediate retry that succeeded teaches nothing.
        if (a.between.length) this.resolved.push({ turn: o.turn, text: lessonText(a, o) });
      }
    }
  }

  // Files are changed and no check has passed since. `lastFailed` says a check ran and failed.
  unverified(): { files: string[]; lastFailed: boolean } | null {
    if (!this.dirty.size) return null;
    return { files: [...this.dirty].sort(), lastFailed: this.lastCheck ? !this.lastCheck.passed : false };
  }

  verdict(completed: boolean): Verdict {
    if (!completed) return this.everChanged || this.checksFailed ? "failed" : "none";
    if (!this.everChanged) return this.checksPassed ? "verified" : "none";
    if (this.dirty.size) return this.lastCheck && !this.lastCheck.passed ? "failed" : "unverified";
    return "verified";
  }

  // Lessons are admitted only when the run as a whole ended verified (D25).
  lessons(verdict: Verdict, max = 3): Lesson[] {
    return verdict === "verified" ? this.resolved.slice(-max) : [];
  }
}

function lessonText(a: Anomaly, fixed: Observation): string {
  const err = a.error ? ` failed with "${a.error}"` : " failed";
  return `\`${a.summary}\`${err}. Resolved by: ${a.between.join("; ")}; then \`${fixed.summary}\` succeeded.`;
}
