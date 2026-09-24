import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Workspace-only shell: the agent's bash and run_tests may read anything but write only inside
// the workspace, temp dirs and per-user tool caches (build caches: go, bun, pip...). File tools
// are already confined by confine(); this closes the shell. The OS mechanism is discovered at
// runtime: sandbox-exec on macOS, bubblewrap on Linux. Without one, the shell is unconfined and
// the caller says so.

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

export function writableRoots(root: string, extra: string[] = []): string[] {
  const home = homedir();
  const paths = [root, tmpdir(), "/tmp", join(home, "Library", "Caches"), join(home, ".cache"), ...extra];
  return [...new Set(paths.map(real))];
}

const q = (s: string) => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

export function seatbeltProfile(writable: string[]): string {
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${writable.map((p) => `(subpath ${q(p)})`).join(" ")} (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper") (regex #"^/dev/tty") (regex #"^/dev/fd/"))`,
  ].join("\n");
}

export type SandboxKind = "sandbox-exec" | "bwrap" | null;

export function sandboxKind(): SandboxKind {
  if (process.platform === "darwin" && Bun.which("sandbox-exec")) return "sandbox-exec";
  if (process.platform === "linux" && Bun.which("bwrap")) return "bwrap";
  return null;
}

// argv prefix placed before `sh -c <command>`; undefined when no sandbox is available.
export function shellPrefix(root: string, extra: string[] = [], kind: SandboxKind = sandboxKind()): string[] | undefined {
  const w = writableRoots(root, extra);
  if (kind === "sandbox-exec") return ["sandbox-exec", "-p", seatbeltProfile(w)];
  if (kind === "bwrap") return ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", ...w.flatMap((p) => ["--bind-try", p, p]), "--"];
  return undefined;
}
