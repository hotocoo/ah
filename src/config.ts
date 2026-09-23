import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ProviderConfig {
  kind: "anthropic" | "openai-compatible" | "gemini" | "ollama" | "mock" | "fal" | "stability" | "replicate" | "meshy" | "tripo";
  baseURL?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface AhConfig {
  defaultModel: string;
  imageModel: string;
  model3d: string;
  maxTokens: number;
  maxTurns: number;
  reasoning: "off" | "low" | "medium" | "high" | "max";
  permissionMode: "ask" | "auto" | "read-only";
  providers: Record<string, ProviderConfig>;
  telemetry: { enabled: boolean; otlpEndpoint?: string; otlpHeaders?: Record<string, string> };
  dataDir: string;
  bashTimeoutMs: number;
  contextBudgetRatio: number; // compact when context exceeds this share of the window
}

export const AH_HOME = process.env.AH_HOME ?? join(homedir(), ".ah");

export const defaultConfig = (): AhConfig => ({
  defaultModel: process.env.AH_MODEL ?? "anthropic/claude-opus-5",
  imageModel: process.env.AH_IMAGE_MODEL ?? "openai/gpt-image-1",
  model3d: process.env.AH_3D_MODEL ?? "procedural/scene",
  maxTokens: 32_000,
  maxTurns: 60,
  reasoning: "high",
  permissionMode: "ask",
  providers: {},
  telemetry: {
    enabled: process.env.AH_TELEMETRY !== "0",
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  },
  dataDir: AH_HOME,
  bashTimeoutMs: 120_000,
  contextBudgetRatio: 0.8,
});

function readJson(path: string): Partial<AhConfig> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<AhConfig>;
  } catch (err) {
    throw new Error(`invalid config ${path}: ${(err as Error).message}`);
  }
}

// Precedence: defaults < ~/.ah/config.json < <cwd>/.ah/config.json.
export function loadConfig(cwd = process.cwd()): AhConfig {
  const base = defaultConfig();
  const user = readJson(join(AH_HOME, "config.json"));
  const project = readJson(join(cwd, ".ah", "config.json"));
  const merged: AhConfig = {
    ...base,
    ...user,
    ...project,
    providers: { ...base.providers, ...user.providers, ...project.providers },
    telemetry: { ...base.telemetry, ...user.telemetry, ...project.telemetry },
  };
  mkdirSync(merged.dataDir, { recursive: true });
  return merged;
}

// Splits "provider/model/with/slashes" at the first slash.
export function parseModelRef(ref: string): { provider: string; model: string } {
  const i = ref.indexOf("/");
  if (i <= 0) throw new Error(`model ref must be "provider/model", got "${ref}"`);
  return { provider: ref.slice(0, i), model: ref.slice(i + 1) };
}
