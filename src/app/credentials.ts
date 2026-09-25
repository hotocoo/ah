import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// API keys entered in the web app, stored as { ENV_VAR: key } in <dataDir>/credentials.json
// (mode 0600). They fill the environment variables models.dev names for each provider, so a
// key saved here behaves exactly like one exported in the shell (which still wins).
const file = (dataDir: string) => join(dataDir, "credentials.json");

export function loadCredentials(dataDir: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(file(dataDir), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function applyCredentials(dataDir: string, env: Record<string, string | undefined> = process.env): void {
  for (const [k, v] of Object.entries(loadCredentials(dataDir))) if (!env[k] && typeof v === "string") env[k] = v;
}

export function saveCredential(dataDir: string, envVar: string, key: string | null): void {
  if (!/^[A-Z][A-Z0-9_]{1,80}$/.test(envVar)) throw new Error(`invalid variable name ${envVar}`);
  const all = loadCredentials(dataDir);
  if (key) all[envVar] = key;
  else delete all[envVar];
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(file(dataDir), JSON.stringify(all, null, 2), { mode: 0o600 });
  chmodSync(file(dataDir), 0o600);
  if (key) process.env[envVar] = key;
  else delete process.env[envVar];
}
