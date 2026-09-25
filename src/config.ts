import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ProviderConfig {
  kind: "anthropic" | "openai-compatible" | "llamacpp" | "lmstudio" | "gemini" | "ollama" | "mock";
  baseURL?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  imageGen?: boolean;
  serverFallbacks?: boolean;
  // Raw request-body fields for every call to this provider (deep-merged, null removes a field).
  params?: Record<string, unknown>;
}

export interface AhConfig {
  // All optional: when unset, ah picks from what it discovers at runtime.
  defaultModel?: string;
  imageModel?: string;
  model3d?: string;
  // Extra runtime endpoints to probe (e.g. a remote Ollama); local ports are scanned automatically.
  runtimes: { endpoints: string[]; scan: boolean };
  // Desired context window for local models; capped by the model's trained maximum.
  contextWindow?: number;
  maxTokens: number;
  maxTurns: number;
  reasoning: "off" | "low" | "medium" | "high" | "max";
  permissionMode: "ask" | "auto" | "read-only";
  providers: Record<string, ProviderConfig>;
  // Per-model overrides keyed by "provider/model". Unset fields fall back to the model
  // card on Hugging Face (generation_config.json), then to the runtime's defaults.
  models: Record<string, { temperature?: number; topP?: number; topK?: number; minP?: number; templateKwargs?: Record<string, unknown>; useModelCard?: boolean; params?: Record<string, unknown> }>;
  telemetry: { enabled: boolean; otlpEndpoint?: string; otlpHeaders?: Record<string, string> };
  dataDir: string;
  bashTimeoutMs: number;
  contextBudgetRatio: number; // compact when context exceeds this share of the window
  // Memory planning for local models (tunables, not model data).
  memory: { fraction: number; minContext: number; kvBytesPerElement: number };
  // Use the compact tool profile when the window is smaller than this many times the
  // size of the full system prompt + tool definitions.
  compactToolsRatio: number;
  // "auto": native tool calls when the runtime reports tool support, else text protocol.
  toolProtocol: "auto" | "native" | "text";
  // Image generation defaults for local diffusion backends (ComfyUI, sdapi).
  image: { width: number; height: number; steps: number; cfg: number; sampler: string; scheduler: string; negative: string };
  hardwareSampling: { enabled: boolean; intervalMs: number };
  // Persistent memory (~/.ah/memory.sqlite): recalled into each request, fed by verified lessons.
  recall: { enabled: boolean; limit: number };
  // Ask a run that changed files to pass a check before finishing (see evidence.ts).
  evidenceGate: boolean;
  // Rebuild context from task + evidence after this many consecutive failed actions (0 = off).
  resetAfterFailures: number;
  // Desktop control tools (screenshot, computer): off, ask (approve every action), auto.
  computerUse: "off" | "ask" | "auto";
  // MCP tool exposure: inline (every schema in every request), deferred (one `mcp` tool plus an
  // index), auto (deferred when MCP schemas outweigh ah's own tools).
  mcpTools: "auto" | "inline" | "deferred";
  // Workspace-only shell: bash/run_tests may write only inside the workspace, temp dirs, tool caches
  // and writablePaths ("auto": OS sandbox when one is found; "off": unconfined).
  shellSandbox: "auto" | "off";
  writablePaths: string[];
  // Named run bundles chosen with --preset (CLI) or the console's preset picker. Nothing built in.
  presets: Record<string, Preset>;
}

export interface Preset {
  description?: string;
  model?: string;
  mode?: "ask" | "auto" | "read-only";
  maxTurns?: number;
  instructions?: string; // appended to the system prompt
  params?: Record<string, unknown>; // request-body fields, as for providers/models
  features?: Record<string, unknown>;
}

export function getPreset(cfg: AhConfig, name: string): Preset {
  const p = cfg.presets[name];
  if (!p) throw new Error(`unknown preset "${name}"; defined: ${Object.keys(cfg.presets).sort().join(", ") || "none (add \"presets\" to ~/.ah/config.json)"}`);
  return p;
}

export const AH_HOME = process.env.AH_HOME ?? join(homedir(), ".ah");

export const defaultConfig = (): AhConfig => ({
  defaultModel: process.env.AH_MODEL,
  imageModel: process.env.AH_IMAGE_MODEL,
  model3d: process.env.AH_3D_MODEL,
  runtimes: { endpoints: [], scan: process.env.AH_SCAN !== "0" },
  contextWindow: process.env.AH_CONTEXT ? Number(process.env.AH_CONTEXT) : undefined,
  maxTokens: 32_000,
  maxTurns: 60,
  reasoning: "high",
  // Auto by default: work proceeds without prompts, confined to the workspace (file tools always,
  // the shell through shellSandbox). Dangerous commands and actions outside the workspace still ask.
  permissionMode: "auto",
  providers: {},
  models: {},
  telemetry: {
    enabled: process.env.AH_TELEMETRY !== "0",
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  },
  dataDir: AH_HOME,
  bashTimeoutMs: 120_000,
  contextBudgetRatio: 0.8,
  memory: { fraction: 0.75, minContext: 16_384, kvBytesPerElement: 2 },
  compactToolsRatio: 6,
  image: { width: 1024, height: 1024, steps: 20, cfg: 7, sampler: "euler", scheduler: "normal", negative: "blurry, low quality, watermark, text" },
  toolProtocol: (process.env.AH_TOOL_PROTOCOL as "auto" | "native" | "text" | undefined) ?? "auto",
  hardwareSampling: { enabled: process.env.AH_HW !== "0", intervalMs: 1000 },
  recall: { enabled: process.env.AH_MEMORY !== "0", limit: 5 },
  evidenceGate: true,
  resetAfterFailures: 4,
  computerUse: (process.env.AH_COMPUTER as "off" | "ask" | "auto" | undefined) ?? "ask",
  mcpTools: "auto",
  shellSandbox: (process.env.AH_SANDBOX as "auto" | "off" | undefined) ?? "auto",
  writablePaths: [],
  presets: {},
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
    models: { ...base.models, ...user.models, ...project.models },
    telemetry: { ...base.telemetry, ...user.telemetry, ...project.telemetry },
    runtimes: { ...base.runtimes, ...user.runtimes, ...project.runtimes },
    presets: { ...base.presets, ...user.presets, ...project.presets },
    image: { ...base.image, ...user.image, ...project.image },
    recall: { ...base.recall, ...user.recall, ...project.recall },
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

// Settings the web app can edit, with their help text and allowed values. Also the validation
// for writes, so the page and the file agree. Keys are dotted paths into AhConfig.
export interface SettingSpec {
  key: string;
  type: "string" | "number" | "boolean" | "list";
  choices?: string[];
  help: string;
  group: string;
}
export const SETTINGS: SettingSpec[] = [
  { key: "defaultModel", type: "string", group: "Models", help: "provider/model used when none is picked. Empty: the best discovered local model." },
  { key: "reasoning", type: "string", choices: ["off", "low", "medium", "high", "max"], group: "Models", help: "Reasoning effort requested from models that support it." },
  { key: "maxTokens", type: "number", group: "Models", help: "Output cap per model call (also capped by the model's own limit)." },
  { key: "contextWindow", type: "number", group: "Models", help: "Context window wanted for local models; capped by the trained maximum and free memory. Empty: sized automatically." },
  { key: "toolProtocol", type: "string", choices: ["auto", "native", "text"], group: "Models", help: "Native tool calls, tools described in the prompt, or auto (native when the runtime reports tool support)." },
  { key: "imageModel", type: "string", group: "Models", help: "provider/model for image generation. Empty: first discovered image backend." },
  { key: "model3d", type: "string", group: "Models", help: "provider/model that designs 3D scenes. Empty: the chat model." },
  { key: "permissionMode", type: "string", choices: ["ask", "auto", "read-only"], group: "Agent", help: "Default permissions for new sessions. auto still asks for dangerous commands and paths outside the workspace." },
  { key: "maxTurns", type: "number", group: "Agent", help: "Model calls allowed per task before it stops." },
  { key: "evidenceGate", type: "boolean", group: "Agent", help: "A task that changed files must pass a check (tests, build) before it may finish." },
  { key: "resetAfterFailures", type: "number", group: "Agent", help: "Rebuild the context from the task and evidence after this many failed actions in a row (0 = off)." },
  { key: "contextBudgetRatio", type: "number", group: "Agent", help: "Compact the conversation when it fills this share of the context window (0-1)." },
  { key: "compactToolsRatio", type: "number", group: "Agent", help: "Offer only core tools when the window is smaller than this many times the prompt plus tool definitions." },
  { key: "bashTimeoutMs", type: "number", group: "Tools", help: "Default timeout for shell commands, in milliseconds." },
  { key: "shellSandbox", type: "string", choices: ["auto", "off"], group: "Tools", help: "auto: shell commands may write only inside the workspace, temp dirs and tool caches." },
  { key: "writablePaths", type: "list", group: "Tools", help: "Extra directories the sandboxed shell may write to (one per line)." },
  { key: "computerUse", type: "string", choices: ["off", "ask", "auto"], group: "Tools", help: "Desktop control tools: hidden, approve every action, or act without asking." },
  { key: "mcpTools", type: "string", choices: ["auto", "inline", "deferred"], group: "Tools", help: "How MCP tools reach the model: every schema inline, one mcp tool plus an index, or auto." },
  { key: "recall.enabled", type: "boolean", group: "Memory", help: "Recall persistent memories into each task and learn from verified runs." },
  { key: "recall.limit", type: "number", group: "Memory", help: "Memories recalled per task." },
  { key: "runtimes.scan", type: "boolean", group: "Runtimes", help: "Scan local ports for model runtimes (Ollama, llama.cpp, LM Studio, vLLM, ...)." },
  { key: "runtimes.endpoints", type: "list", group: "Runtimes", help: "Extra runtime URLs to probe, e.g. a remote Ollama (one per line)." },
  { key: "telemetry.enabled", type: "boolean", group: "Telemetry", help: "Record runs, turns and tool calls locally (SQLite + JSONL)." },
  { key: "telemetry.otlpEndpoint", type: "string", group: "Telemetry", help: "Also export traces and metrics to this OTLP/HTTP endpoint." },
  { key: "hardwareSampling.enabled", type: "boolean", group: "Telemetry", help: "Sample GPU, memory and power during runs." },
];

export function getPath(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

// Checks a value for a setting; null clears it (back to the default). Throws on bad input.
export function checkSetting(key: string, value: unknown): unknown {
  const spec = SETTINGS.find((s) => s.key === key);
  if (!spec) throw new Error(`unknown setting ${key}`);
  if (value === null || value === "") return null;
  if (spec.type === "boolean" && typeof value !== "boolean") throw new Error(`${key} must be true or false`);
  if (spec.type === "number" && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error(`${key} must be a non-negative number`);
  if (spec.type === "string" && typeof value !== "string") throw new Error(`${key} must be text`);
  if (spec.type === "list" && !(Array.isArray(value) && value.every((v) => typeof v === "string"))) throw new Error(`${key} must be a list of strings`);
  if (spec.choices && !spec.choices.includes(value as string)) throw new Error(`${key} must be one of ${spec.choices.join(", ")}`);
  return value;
}

export const userConfigPath = () => join(AH_HOME, "config.json");
