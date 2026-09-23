import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Locates an on-disk asset directory of the ah checkout (bench suites, example results).
// Works when run from source (next to src/), as a compiled binary (next to the
// executable or one level up, e.g. dist/ah), or from a checkout as the cwd.
export function assetDir(rel: string): string | null {
  const candidates = [
    process.env.AH_ROOT ? join(process.env.AH_ROOT, rel) : "",
    resolve(import.meta.dir, "../..", rel),
    resolve(dirname(process.execPath), rel),
    resolve(dirname(process.execPath), "..", rel),
    resolve(process.cwd(), rel),
  ].filter(Boolean);
  return candidates.find((c) => !c.includes("$bunfs") && existsSync(c)) ?? null;
}
