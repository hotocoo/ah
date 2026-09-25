import { join } from "node:path";
import { applyCredentials } from "./credentials.ts";
import { Agent, type AgentOptions } from "../agent/loop.ts";
import { buildSystemPrompt } from "../agent/prompt.ts";
import { deferMcpTools, shouldDefer } from "../mcp/deferred.ts";
import { coachingHints, renderCoaching } from "../agent/coaching.ts";
import { mergeParams } from "../providers/provider.ts";
import { shellPrefix } from "../tools/sandbox.ts";
import { projectFacts, renderProjectFacts } from "../agent/project.ts";
import { getPreset, loadConfig, parseModelRef, type AhConfig } from "../config.ts";
import type { LocalModelFacts, ModelInfo } from "../core/types.ts";
import { ModelCatalog } from "../models/catalog.ts";
import { hubRepoFrom, modelArchFacts, modelCardDefaults } from "../models/hf.ts";
import { templateControls, type TemplateControl } from "../models/template.ts";
import { buildMedia } from "../media/services.ts";
import { OllamaProvider } from "../providers/ollama.ts";
import { ProviderRegistry } from "../providers/registry.ts";
import { resolveContextWindow, type ContextDecision } from "../runtimes/context.ts";
import { discoverRuntimes, type RuntimeInfo } from "../runtimes/discover.ts";
import { sampleHardware } from "../runtimes/hardware.ts";
import { Telemetry } from "../telemetry/index.ts";
import { ToolRegistry } from "../tools/index.ts";
import { detectTestCommand } from "../tools/shell.ts";
import { MemoryStore } from "../memory/store.ts";
import { McpManager } from "../mcp/client.ts";
import { discoverExtensions, loadPluginTools, renderSkillIndex, skillViewTool, type Extensions } from "../plugins/index.ts";
import { ALL_TOOLS } from "../tools/index.ts";
import type { Tool } from "../tools/types.ts";
import type { ApprovalFn, MediaServices } from "../tools/types.ts";

// Everything a command needs, assembled from discovery: config, runtimes, providers,
// model catalog and telemetry. Built once per process.
export interface Environment {
  cfg: AhConfig;
  runtimes: RuntimeInfo[];
  registry: ProviderRegistry;
  catalog: ModelCatalog;
  telemetry: Telemetry;
  memory?: MemoryStore;
  // Plugins, skills and MCP connections per workspace root, loaded on first session.
  extensions: Map<string, Promise<LoadedExtensions>>;
  offline?: boolean; // no network lookups (tests, air-gapped use)
}

export interface LoadedExtensions {
  ext: Extensions;
  mcp: McpManager;
  tools: Tool[]; // MCP + plugin tools + skill_view, sorted
  prompt: string; // skill index, plugin and MCP server instructions
}

// Discovers and connects extensions for a workspace once per process.
export function loadExtensions(env: Environment, root: string): Promise<LoadedExtensions> {
  let p = env.extensions.get(root);
  if (!p) {
    p = (async () => {
      const ext = discoverExtensions(root, env.cfg.dataDir);
      const mcp = new McpManager(ext.mcpServers);
      const [mcpTools, pluginTools] = await Promise.all([mcp.tools(), loadPluginTools(ext)]);
      const deferred = shouldDefer(env.cfg.mcpTools, mcpTools, ALL_TOOLS) ? deferMcpTools(mcpTools) : undefined;
      const tools = [...(deferred ? [deferred.tool] : mcpTools), ...pluginTools, ...(ext.skills.length ? [skillViewTool(ext.skills)] : [])];
      const serverNotes = deferred
        ? [deferred.index]
        : mcp
            .status()
            .filter((s) => s.connected)
            .map((s) => `- MCP server ${s.name}: ${s.tools.length} tools (mcp__${s.name}__*)`);
      const prompt = [renderSkillIndex(ext.skills), ...ext.instructions, serverNotes.join("\n")].filter(Boolean).join("\n\n");
      return { ext, mcp, tools, prompt };
    })();
    env.extensions.set(root, p);
  }
  return p;
}

export async function buildEnvironment(opts: { cwd?: string; offline?: boolean; live?: boolean; cfg?: AhConfig } = {}): Promise<Environment> {
  const cfg = opts.cfg ?? loadConfig(opts.cwd);
  applyCredentials(cfg.dataDir);
  const telemetry = Telemetry.fromConfig(cfg);
  const runtimes = await discoverRuntimes({ endpoints: cfg.runtimes.endpoints, scan: cfg.runtimes.scan });
  // models.dev provider metadata (base URL, env var, SDK) for optional cloud providers.
  const mdRaw = telemetry.store?.cacheGet("models.dev", Number.POSITIVE_INFINITY);
  const registry = ProviderRegistry.build({ cfg, runtimes, catalog: mdRaw ? JSON.parse(mdRaw) : null, store: telemetry.store });
  const catalog = new ModelCatalog({ store: telemetry.store, registry, offline: opts.offline });
  await catalog.load({ live: opts.live ?? true });
  const memory = cfg.recall.enabled ? new MemoryStore(join(cfg.dataDir, "memory.sqlite")) : undefined;
  return { cfg, runtimes, registry, catalog, telemetry, memory, extensions: new Map(), offline: opts.offline };
}

// Re-discover runtimes, rebuild providers (e.g. after an API key was added) and reload the
// catalog; `refresh` also re-fetches models.dev and OpenRouter instead of using the cache.
export async function refreshProviders(env: Environment, opts: { refresh?: boolean } = {}): Promise<void> {
  env.runtimes = await discoverRuntimes({ endpoints: env.cfg.runtimes.endpoints, scan: env.cfg.runtimes.scan });
  // models.dev first (it names the providers), then the registry built from it lists live models.
  if (opts.refresh && !env.offline) await new ModelCatalog({ store: env.telemetry.store }).load({ refresh: true, live: false });
  const mdRaw = env.telemetry.store?.cacheGet("models.dev", Number.POSITIVE_INFINITY);
  env.registry = ProviderRegistry.build({ cfg: env.cfg, runtimes: env.runtimes, catalog: mdRaw ? JSON.parse(mdRaw) : null, store: env.telemetry.store });
  env.catalog = new ModelCatalog({ store: env.telemetry.store, registry: env.registry, offline: env.offline });
  await env.catalog.load({ live: !env.offline });
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

// Harness features that can be switched off, for ablation benchmarks
// (e.g. "ah" vs a baseline loop without local-model adaptations).
export interface SessionFeatures {
  contextSizing?: boolean; // explicit, memory-aware context window + compaction (default on)
  textToolParsing?: boolean; // recover tool calls written as text (default on)
  compactTools?: boolean; // compact tool profile for small windows (default on)
  projectFacts?: boolean; // languages/test command/toolchains in the system prompt (default on)
  tolerantEdits?: boolean; // indentation-tolerant edit matching (default on)
  recoveries?: boolean; // loop guard, empty-turn nudges, dropped-tool-call fallback (default on)
  evidence?: boolean; // completion gate + post-write syntax check (default on)
  memory?: boolean; // persistent memory recall and lessons (default on; off in benchmarks)
  extensions?: boolean; // plugins, skills and MCP servers (default on; off in benchmarks)
  toolProtocol?: "auto" | "native" | "text";
}

// Context window for a model: runtime-fixed value, a healthy resident allocation, or a
// memory-aware computed window (persisted per model so Ollama is not reloaded).
// Every request to a local runtime must carry this; see D19.
export async function resolveModelContext(env: Environment, modelRef: string): Promise<{ facts?: LocalModelFacts; context: ContextDecision }> {
  const { provider, model } = parseModelRef(modelRef);
  const p = env.registry.get(provider);
  const info = env.catalog.lookup(modelRef);
  let facts = localFacts(env, provider, model);
  // Runtimes without GGUF metadata (MLX, vLLM...): take architecture facts from the
  // model's config.json on the Hub so context sizing is memory-aware there too.
  if (facts && !facts.fixedContext && !facts.kv) {
    const rt = env.registry.runtimes.get(provider);
    const repo = hubRepoFrom(model) ?? hubRepoFrom(typeof rt?.meta.modelPath === "string" ? rt.meta.modelPath : undefined);
    const arch = repo ? await modelArchFacts(repo, { store: env.telemetry.store }) : null;
    if (arch) facts = { ...facts, trainedContext: facts.trainedContext ?? arch.trainedContext, kv: arch.kv, sizeBytes: facts.sizeBytes ?? arch.sizeBytes };
  }
  if (!facts) return { context: { window: info?.contextWindow ?? env.cfg.memory.minContext, reason: info?.contextWindow ? "catalog" : "unknown; minimum agent context" } };
  const hw = await sampleHardware();
  const resident = p instanceof OllamaProvider ? await p.residentContext(model) : undefined;
  const computed = resolveContextWindow({
    facts: facts.fixedContext ? facts : { ...facts },
    catalogContext: info?.contextWindow,
    desired: env.cfg.contextWindow,
    memTotalBytes: hw.memTotalBytes,
    // When the model is already resident its memory is inside gpuAllocBytes; don't count it twice.
    otherGpuAllocBytes: facts.fixedContext ? undefined : Math.max(0, (hw.gpuAllocBytes ?? 0) - (resident ? (facts.sizeBytes ?? 0) : 0)),
    memFraction: env.cfg.memory.fraction,
    minContext: env.cfg.memory.minContext,
    kvBytesPerElement: env.cfg.memory.kvBytesPerElement,
  });
  if (facts.fixedContext) return { facts, context: computed };
  // A resident model keeps its context only if that allocation fits the memory budget;
  // an oversized one (e.g. loaded at a runtime default) is replaced by a healthy window.
  if (resident && (computed.maxByMemory === undefined || resident <= computed.maxByMemory))
    return { facts: { ...facts, fixedContext: resident }, context: { window: resident, reason: "model already resident with this context (avoids a reload)" } };
  const key = `ctx:${modelRef}`;
  const persisted = Number(env.telemetry.store?.cacheGet(key, Number.POSITIVE_INFINITY) ?? 0);
  if (persisted && (computed.maxByMemory === undefined || persisted <= computed.maxByMemory))
    return { facts, context: { window: persisted, reason: "previously chosen for this model (stable num_ctx avoids reloads)" } };
  env.telemetry.store?.cacheSet(key, String(computed.window));
  return { facts, context: computed };
}

export interface GenerationSettings {
  temperature?: number;
  sampling?: { topP?: number; topK?: number; minP?: number };
  templateKwargs?: Record<string, unknown>;
  params?: Record<string, unknown>; // provider params < model params (request-body passthrough)
  source: string; // where the values came from, for display
}

// Sampling and chat-template settings: per-model config > the model card on Hugging Face
// (generation_config.json, following base_model for quantised repos) > runtime defaults.
export async function generationSettings(env: Environment, modelRef: string): Promise<GenerationSettings> {
  const { provider, model } = parseModelRef(modelRef);
  const o = env.cfg.models[modelRef] ?? {};
  const rt = env.registry.runtimes.get(provider);
  let card: Awaited<ReturnType<typeof modelCardDefaults>> = null;
  // Ollama applies its own Modelfile parameters server-side; other local runtimes need them sent.
  if (rt && rt.kind !== "ollama" && o.useModelCard !== false) {
    const repo = hubRepoFrom(model) ?? hubRepoFrom(typeof rt.meta.modelPath === "string" ? rt.meta.modelPath : undefined);
    if (repo) card = await modelCardDefaults(repo, { store: env.telemetry.store });
  }
  const toggle = Boolean(card?.templateThinkingToggle || rt?.meta.templateThinkingToggle);
  const pick = <T,>(a: T | undefined, b: T | undefined) => (a !== undefined ? a : b);
  const sampling = { topP: pick(o.topP, card?.sampling.topP), topK: pick(o.topK, card?.sampling.topK), minP: pick(o.minP, card?.sampling.minP) };
  return {
    temperature: pick(o.temperature, card?.sampling.temperature),
    sampling: Object.values(sampling).some((v) => v !== undefined) ? sampling : undefined,
    templateKwargs: o.templateKwargs ?? (toggle ? { enable_thinking: env.cfg.reasoning !== "off" } : undefined),
    params: env.cfg.providers[provider]?.params || o.params ? mergeParams(env.cfg.providers[provider]?.params ?? {}, o.params) : undefined,
    source: env.cfg.models[modelRef] ? "config" : card ? `model card ${card.repo}` : "runtime defaults",
  };
}

export interface SessionOptions {
  features?: SessionFeatures;
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
  preset?: string; // name in cfg.presets; explicit options win over it
  params?: Record<string, unknown>; // per-invocation request-body fields (e.g. `--param`), merged last
  generation?: GenerationOverrides; // per-session reasoning effort, sampling and output cap (web app, CLI flags)
  toolContextExtras?: Partial<AgentOptions["toolContext"]>;
}

export interface GenerationOverrides {
  reasoning?: "off" | "low" | "medium" | "high" | "max";
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  templateKwargs?: Record<string, string | number | boolean>; // chat-template switches (effort levels, enable_thinking, ...)
}

export interface Session {
  agent: Agent;
  compactTools: boolean;
  generation: GenerationSettings;
  toolProtocol: "native" | "text";
  modelRef: string;
  info?: ModelInfo;
  context: ContextDecision;
}

function withSampling(base: GenerationSettings["sampling"], g?: GenerationOverrides): GenerationSettings["sampling"] {
  if (g?.topP === undefined && g?.topK === undefined) return base;
  return { ...base, ...(g.topP !== undefined ? { topP: g.topP } : {}), ...(g.topK !== undefined ? { topK: g.topK } : {}) };
}

export async function createSession(env: Environment, opts: SessionOptions): Promise<Session> {
  const pre = opts.preset ? getPreset(env.cfg, opts.preset) : undefined;
  const o: SessionOptions = pre
    ? { ...opts, model: opts.model || pre.model, mode: opts.mode ?? pre.mode, maxTurns: opts.maxTurns ?? pre.maxTurns, features: { ...(pre.features as SessionFeatures), ...opts.features }, params: pre.params || opts.params ? mergeParams(pre.params ?? {}, opts.params) : undefined }
    : opts;
  // An empty string (e.g. a UI with nothing selected) means "pick for me".
  const modelRef = o.model || env.cfg.defaultModel || autoSelectModel(env);
  if (!modelRef) {
    const found = env.runtimes.map((r) => `${r.kind} at ${r.baseURL} (${r.models.length} models)`).join("; ") || "none";
    throw new Error(`no model configured and none discovered. Runtimes found: ${found}. Pull or load a model, or pass --model provider/model.`);
  }
  const { provider, model } = parseModelRef(modelRef);
  const p = env.registry.get(provider);
  const info = env.catalog.lookup(modelRef);
  const { facts, context } = await resolveModelContext(env, modelRef);
  const gen = await generationSettings(env, modelRef);
  const f = o.features ?? {};
  const loaded = f.extensions === false ? undefined : await loadExtensions(env, o.root);
  const tools = new ToolRegistry([...ALL_TOOLS, ...(loaded?.tools ?? [])]);
  // Compact profile when the window is small relative to the prompt + tool definitions.
  const projectInfo = f.projectFacts === false ? undefined : projectFacts(o.root);
  const project = projectInfo ? renderProjectFacts(projectInfo) : undefined;
  const testCommand = projectInfo ? projectInfo.testCommand : detectTestCommand(o.root);
  const memory = f.memory !== false && env.memory ? { store: env.memory, scopes: [o.root, "global"] } : undefined;
  // Coaching reads past runs, so it follows the memory switch (bench trials stay independent).
  const db = f.memory !== false ? env.telemetry.store?.db : undefined;
  const coaching = db ? renderCoaching(coachingHints(db, provider, model)) : "";
  const extensionsPrompt = [loaded?.prompt, pre?.instructions, coaching].filter(Boolean).join("\n\n") || undefined;
  const fullPrompt = buildSystemPrompt({ root: o.root, model: modelRef, toolNames: tools.names(), project, extensions: extensionsPrompt });
  const overheadTokens = Math.ceil((fullPrompt.length + JSON.stringify(tools.specs()).length) / 4);
  const compactTools = f.compactTools !== false && context.window < overheadTokens * env.cfg.compactToolsRatio;
  // Runtime-reported tool support decides the protocol; unknown means try native (the
  // text parser still recovers calls written as text).
  const protocolSetting = f.toolProtocol ?? env.cfg.toolProtocol;
  const toolProtocol: "native" | "text" = protocolSetting !== "auto" ? protocolSetting : info && info.toolCall === false ? "text" : "native";
  const toolContext = {
    root: o.root,
    bashTimeoutMs: env.cfg.bashTimeoutMs,
    todos: [],
    readFiles: new Set<string>(),
    exactEdits: f.tolerantEdits === false,
    shellPrefix: env.cfg.shellSandbox === "off" ? undefined : shellPrefix(o.root, env.cfg.writablePaths),
    syntaxCheck: f.evidence !== false,
    computer: env.cfg.computerUse,
    memory,
    media: o.media ?? buildMedia(env.cfg, env.registry, { provider, model, contextWindow: context.window }),
    signal: o.signal,
    ...o.toolContextExtras,
  };
  // provider params < model params < preset params < per-invocation params
  const params = gen.params || o.params ? mergeParams(gen.params ?? {}, o.params) : undefined;
  const agent = new Agent({
    provider: p,
    model,
    system: o.system ?? buildSystemPrompt({ root: o.root, model: modelRef, toolNames: tools.specs(o.mode ?? env.cfg.permissionMode, toolContext, compactTools).map((t) => t.name), project, extensions: extensionsPrompt }),
    compactTools,
    toolProtocol,
    tools,
    toolContext,
    mode: o.mode ?? env.cfg.permissionMode,
    approve: o.approve,
    maxTurns: o.maxTurns ?? env.cfg.maxTurns,
    // Output cap: never more than a quarter of the window for local models.
    maxTokens: Math.min(o.generation?.maxTokens ?? env.cfg.maxTokens, info?.maxOutput ?? Number.POSITIVE_INFINITY, facts ? Math.floor(context.window / 4) : Number.POSITIVE_INFINITY),
    maxOutputTokens: info?.maxOutput,
    reasoning: o.generation?.reasoning ?? env.cfg.reasoning,
    temperature: o.generation?.temperature ?? gen.temperature,
    sampling: withSampling(gen.sampling, o.generation),
    templateKwargs: o.generation?.templateKwargs ? { ...gen.templateKwargs, ...o.generation.templateKwargs } : gen.templateKwargs,
    params,
    // Without context sizing the runtime default applies and no compaction happens.
    contextWindow: f.contextSizing === false ? undefined : context.window,
    parseTextToolCalls: f.textToolParsing !== false,
    recoveries: f.recoveries !== false,
    contextBudgetRatio: env.cfg.contextBudgetRatio,
    pricing: facts ? { input: 0, output: 0 } : info?.cost,
    budgetUsd: o.budgetUsd,
    onEvent: (e) => {
      env.telemetry.handler(e);
      if (e.type === "run_start") env.telemetry.store?.setContextWindow(e.runId, context.window);
      o.onEvent?.(e);
    },
    signal: o.signal,
    evidenceGate: f.evidence !== false && env.cfg.evidenceGate,
    resetAfterFailures: f.evidence === false ? 0 : env.cfg.resetAfterFailures,
    testCommand,
    memory: memory && { ...memory, recallLimit: env.cfg.recall.limit },
  });
  return { agent, modelRef, info, context, compactTools, toolProtocol, generation: { ...gen, params } };
}

export const dataPath = (env: Environment, ...parts: string[]) => join(env.cfg.dataDir, ...parts);

// The switches a model's chat template accepts, read from the template itself: the serving
// runtime's copy (llama.cpp /props) when it has one, else the Hugging Face model card's.
export async function modelControls(env: Environment, ref: string): Promise<{ controls: TemplateControl[]; source: string | null }> {
  const { provider, model } = parseModelRef(ref);
  const rt = env.registry.runtimes.get(provider);
  if (rt && !env.offline) {
    try {
      const res = await fetch(`${rt.baseURL}/props?model=${encodeURIComponent(model)}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const t = ((await res.json()) as { chat_template?: string }).chat_template;
        if (t) return { controls: templateControls(t), source: `${provider} runtime chat template` };
      }
    } catch {
      /* runtime without /props: fall back to the model card */
    }
  }
  const repo = hubRepoFrom(model);
  const card = repo && !env.offline ? await modelCardDefaults(repo, { store: env.telemetry.store }).catch(() => null) : null;
  return card?.controls?.length ? { controls: card.controls, source: `model card ${card.repo}` } : { controls: [], source: null };
}
