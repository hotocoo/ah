import { join } from "node:path";
import { Agent, type AgentOptions } from "../agent/loop.ts";
import { buildSystemPrompt } from "../agent/prompt.ts";
import { loadConfig, parseModelRef, type AhConfig } from "../config.ts";
import type { LocalModelFacts, ModelInfo } from "../core/types.ts";
import { ModelCatalog } from "../models/catalog.ts";
import { OllamaProvider } from "../providers/ollama.ts";
import { ProviderRegistry } from "../providers/registry.ts";
import { resolveContextWindow, type ContextDecision } from "../runtimes/context.ts";
import { discoverRuntimes, type RuntimeInfo } from "../runtimes/discover.ts";
import { sampleHardware } from "../runtimes/hardware.ts";
import { Telemetry } from "../telemetry/index.ts";
import { ToolRegistry } from "../tools/index.ts";
import type { ApprovalFn, MediaServices } from "../tools/types.ts";

// Everything a command needs, assembled from discovery: config, runtimes, providers,
// model catalog and telemetry. Built once per process.
export interface Environment {
  cfg: AhConfig;
  runtimes: RuntimeInfo[];
  registry: ProviderRegistry;
  catalog: ModelCatalog;
  telemetry: Telemetry;
}

export async function buildEnvironment(opts: { cwd?: string; offline?: boolean; live?: boolean; cfg?: AhConfig } = {}): Promise<Environment> {
  const cfg = opts.cfg ?? loadConfig(opts.cwd);
  const telemetry = Telemetry.fromConfig(cfg);
  const runtimes = await discoverRuntimes({ endpoints: cfg.runtimes.endpoints, scan: cfg.runtimes.scan });
  // models.dev provider metadata (base URL, env var, SDK) for optional cloud providers.
  const mdRaw = telemetry.store?.cacheGet("models.dev", Number.POSITIVE_INFINITY);
  const registry = ProviderRegistry.build({ cfg, runtimes, catalog: mdRaw ? JSON.parse(mdRaw) : null, store: telemetry.store });
  const catalog = new ModelCatalog({ store: telemetry.store, registry, offline: opts.offline });
  await catalog.load({ live: opts.live ?? true });
  return { cfg, runtimes, registry, catalog, telemetry };
}

// Facts about a runtime-served model: llama.cpp/LM Studio fix n_ctx at load time.
export function localFacts(env: Environment, provider: string, model: string): LocalModelFacts | undefined {
  const info = env.catalog.lookup(`${provider}/${model}`);
  const rt = env.registry.runtimes.get(provider);
  const facts: LocalModelFacts | undefined = info?.local ?? (rt ? { runtime: provider } : undefined);
  if (!facts || !rt) return facts;
  if (rt.kind === "llamacpp" && typeof rt.meta.nCtx === "number") return { ...facts, fixedContext: rt.meta.nCtx };
  if (rt.kind === "lmstudio") {
    const m = (rt.meta.models as { id: string; loaded_context_length?: number; max_context_length?: number }[] | undefined)?.find((x) => x.id === model);
    return { ...facts, fixedContext: m?.loaded_context_length, trainedContext: m?.max_context_length ?? facts.trainedContext };
  }
  return facts;
}

// Picks a model when none is configured: a model already resident in a local runtime
// wins (no load time), then the largest tool-capable local chat model.
export function autoSelectModel(env: Environment): string | null {
  const local = env.catalog
    .all()
    .filter((m) => env.registry.runtimes.has(m.provider) && m.kinds.includes("chat") && !m.kinds.includes("embedding"));
  const resident = env.runtimes.find((r) => (r.kind === "llamacpp" || r.kind === "lmstudio") && r.models.length);
  if (resident) {
    const key = [...env.registry.runtimes.entries()].find(([, r]) => r === resident)?.[0];
    if (key) return `${key}/${resident.models[0]}`;
  }
  const ranked = local.filter((m) => m.toolCall).sort((a, b) => (b.local?.sizeBytes ?? 0) - (a.local?.sizeBytes ?? 0));
  const pick = ranked[0] ?? local[0];
  return pick ? `${pick.provider}/${pick.id}` : null;
}

export interface SessionOptions {
  model?: string;
  root: string;
  mode?: AgentOptions["mode"];
  approve?: ApprovalFn;
  media?: MediaServices;
  maxTurns?: number;
  budgetUsd?: number;
  onEvent?: AgentOptions["onEvent"];
  signal?: AbortSignal;
  system?: string;
  toolContextExtras?: Partial<AgentOptions["toolContext"]>;
}

export interface Session {
  agent: Agent;
  compactTools: boolean;
  toolProtocol: "native" | "text";
  modelRef: string;
  info?: ModelInfo;
  context: ContextDecision;
}

export async function createSession(env: Environment, o: SessionOptions): Promise<Session> {
  const modelRef = o.model ?? env.cfg.defaultModel ?? autoSelectModel(env);
  if (!modelRef) {
    const found = env.runtimes.map((r) => `${r.kind} at ${r.baseURL} (${r.models.length} models)`).join("; ") || "none";
    throw new Error(`no model configured and none discovered. Runtimes found: ${found}. Pull or load a model, or pass --model provider/model.`);
  }
  const { provider, model } = parseModelRef(modelRef);
  const p = env.registry.get(provider);
  const info = env.catalog.lookup(modelRef);
  let facts = localFacts(env, provider, model);
  // A resident Ollama model keeps its current context; asking for another size reloads it.
  if (facts && p instanceof OllamaProvider) {
    const resident = await p.residentContext(model);
    if (resident) facts = { ...facts, fixedContext: resident };
  }
  const hw = facts ? await sampleHardware() : undefined;
  const persistedKey = `ctx:${modelRef}`;
  const persisted = facts && !facts.fixedContext ? Number(env.telemetry.store?.cacheGet(persistedKey, Number.POSITIVE_INFINITY) ?? 0) : 0;
  const context: ContextDecision = persisted
    ? { window: persisted, reason: "previously chosen for this model (stable num_ctx avoids reloads)" }
    : facts
    ? resolveContextWindow({
        facts,
        catalogContext: info?.contextWindow,
        desired: env.cfg.contextWindow,
        memTotalBytes: hw!.memTotalBytes,
        // Other processes' GPU memory; a resident model of this runtime is already counted in its size.
        otherGpuAllocBytes: facts.fixedContext ? undefined : hw!.gpuAllocBytes,
        memFraction: env.cfg.memory.fraction,
        minContext: env.cfg.memory.minContext,
        kvBytesPerElement: env.cfg.memory.kvBytesPerElement,
      })
    : { window: info?.contextWindow ?? env.cfg.memory.minContext, reason: info?.contextWindow ? "catalog" : "unknown; minimum agent context" };
  if (facts && !facts.fixedContext && !persisted) env.telemetry.store?.cacheSet(persistedKey, String(context.window));
  const tools = new ToolRegistry();
  // Compact profile when the window is small relative to the prompt + tool definitions.
  const fullPrompt = buildSystemPrompt({ root: o.root, model: modelRef, toolNames: tools.names() });
  const overheadTokens = Math.ceil((fullPrompt.length + JSON.stringify(tools.specs()).length) / 4);
  const compactTools = context.window < overheadTokens * env.cfg.compactToolsRatio;
  // Runtime-reported tool support decides the protocol; unknown means try native (the
  // text parser still recovers calls written as text).
  const toolProtocol: "native" | "text" = env.cfg.toolProtocol !== "auto" ? env.cfg.toolProtocol : info && info.toolCall === false ? "text" : "native";
  const toolContext = {
    root: o.root,
    bashTimeoutMs: env.cfg.bashTimeoutMs,
    todos: [],
    readFiles: new Set<string>(),
    media: o.media ?? {},
    ...o.toolContextExtras,
  };
  const agent = new Agent({
    provider: p,
    model,
    system: o.system ?? buildSystemPrompt({ root: o.root, model: modelRef, toolNames: tools.specs(o.mode ?? env.cfg.permissionMode, toolContext, compactTools).map((t) => t.name) }),
    compactTools,
    toolProtocol,
    tools,
    toolContext,
    mode: o.mode ?? env.cfg.permissionMode,
    approve: o.approve,
    maxTurns: o.maxTurns ?? env.cfg.maxTurns,
    // Output cap: never more than a quarter of the window for local models.
    maxTokens: Math.min(env.cfg.maxTokens, info?.maxOutput ?? Number.POSITIVE_INFINITY, facts ? Math.floor(context.window / 4) : Number.POSITIVE_INFINITY),
    maxOutputTokens: info?.maxOutput,
    reasoning: env.cfg.reasoning,
    contextWindow: context.window,
    contextBudgetRatio: env.cfg.contextBudgetRatio,
    pricing: facts ? { input: 0, output: 0 } : info?.cost,
    budgetUsd: o.budgetUsd,
    onEvent: (e) => {
      env.telemetry.handler(e);
      if (e.type === "run_start") env.telemetry.store?.setContextWindow(e.runId, context.window);
      o.onEvent?.(e);
    },
    signal: o.signal,
  });
  return { agent, modelRef, info, context, compactTools, toolProtocol };
}

export const dataPath = (env: Environment, ...parts: string[]) => join(env.cfg.dataDir, ...parts);
