import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { walkFiles } from "../tools/search.ts";
import { detectTestCommand } from "../tools/shell.ts";

// A short, factual summary of the workspace for the system prompt: languages, manifests,
// the detected test command and which toolchains are actually installed. Observed need:
// without it, local models guess (`deno test` in a Bun project, `find /` for runtimes).

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".mjs": "JavaScript", ".jsx": "JavaScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".rb": "Ruby",
  ".swift": "Swift", ".c": "C", ".h": "C", ".cpp": "C++", ".cc": "C++", ".hpp": "C++", ".cs": "C#", ".php": "PHP", ".scala": "Scala", ".zig": "Zig",
};

// Toolchain binaries worth reporting for each language.
const TOOLCHAINS: Record<string, string[]> = {
  TypeScript: ["bun", "node", "deno", "tsc", "npm", "pnpm"],
  JavaScript: ["bun", "node", "deno", "npm", "pnpm"],
  Python: ["python3", "uv", "pytest"],
  Go: ["go"],
  Rust: ["cargo", "rustc"],
  Java: ["java", "mvn", "gradle"],
  Kotlin: ["kotlinc", "gradle"],
  Ruby: ["ruby", "bundle"],
  Swift: ["swift"],
  C: ["cc", "make", "cmake"],
  "C++": ["c++", "make", "cmake"],
  "C#": ["dotnet"],
  PHP: ["php", "composer"],
  Scala: ["sbt"],
  Zig: ["zig"],
};

const MANIFESTS = ["package.json", "bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "tsconfig.json", "deno.json", "Cargo.toml", "go.mod", "pyproject.toml", "requirements.txt", "setup.py", "pytest.ini", "Makefile", "CMakeLists.txt", "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "composer.json"];

const versionCache = new Map<string, string | null>();

function version(bin: string): string | null {
  if (versionCache.has(bin)) return versionCache.get(bin)!;
  const path = Bun.which(bin);
  let v: string | null = null;
  if (path) {
    try {
      const flag = bin === "go" ? "version" : "--version";
      const r = Bun.spawnSync([path, flag], { stdout: "pipe", stderr: "pipe", timeout: 3000 });
      const out = `${r.stdout.toString()}${r.stderr.toString()}`.trim().split("\n")[0] ?? "";
      v = out.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? "installed";
    } catch {
      v = "installed";
    }
  }
  versionCache.set(bin, v);
  return v;
}

export interface ProjectFacts {
  languages: { name: string; files: number }[];
  manifests: string[];
  testCommand: string | null;
  toolchains: { bin: string; version: string }[];
  packageScripts: Record<string, string>;
}

export function projectFacts(root: string, maxFiles = 3000): ProjectFacts {
  const counts = new Map<string, number>();
  let n = 0;
  for (const f of walkFiles(root)) {
    if (++n > maxFiles) break;
    const lang = LANG_BY_EXT[extname(f)];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  const languages = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, files]) => ({ name, files }));
  const manifests = MANIFESTS.filter((m) => existsSync(join(root, m)));
  let packageScripts: Record<string, string> = {};
  if (manifests.includes("package.json")) {
    try {
      packageScripts = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch {
      /* invalid package.json: leave empty */
    }
  }
  const bins = [...new Set(languages.flatMap((l) => TOOLCHAINS[l.name] ?? []))];
  const toolchains = bins.map((bin) => ({ bin, version: version(bin) })).filter((t): t is { bin: string; version: string } => t.version !== null);
  return { languages, manifests, testCommand: detectTestCommand(root), toolchains, packageScripts };
}

export function renderProjectFacts(p: ProjectFacts): string {
  const lines: string[] = [];
  if (p.languages.length) lines.push(`- Languages: ${p.languages.map((l) => `${l.name} (${l.files} files)`).join(", ")}`);
  if (p.manifests.length) lines.push(`- Project files: ${p.manifests.join(", ")}`);
  const scripts = Object.entries(p.packageScripts).slice(0, 8);
  if (scripts.length) lines.push(`- package.json scripts: ${scripts.map(([k, v]) => `${k}: \`${v}\``).join("; ")}`);
  lines.push(`- Test command: ${p.testCommand ? `\`${p.testCommand}\` (run_tests uses it)` : "not detected; find one from the project files"}`);
  if (p.toolchains.length) lines.push(`- Installed toolchains: ${p.toolchains.map((t) => `${t.bin} ${t.version}`).join(", ")}. Use these; do not search the filesystem for others.`);
  return lines.join("\n");
}
