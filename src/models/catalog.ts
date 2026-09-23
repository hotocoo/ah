import type { Modality, ModelInfo, ModelKind } from "../core/types.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { TelemetryStore } from "../telemetry/store.ts";

const DAY = 86_400_000;
const MODELS_DEV_URL = "https://models.dev/api.json";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

const MODALITIES = new Set<Modality>(["text", "image", "audio", "video", "pdf", "3d", "embedding"]);
const asModalities = (xs: unknown): Modality[] =>
  Array.isArray(xs) ? (xs.filter((x) => MODALITIES.has(x as Modality)) as Modality[]) : ["text"];

interface ModelsDevModel {
  id: string;
  name?: string;
  family?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  open_weights?: boolean;
  release_date?: string;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
}

// Model kinds derived purely from declared output modalities.
export function kindsFor(output: Modality[]): ModelKind[] {
  const kinds: ModelKind[] = [];
  if (output.includes("text")) kinds.push("chat");
  if (output.includes("image")) kinds.push("image-gen");
  if (output.includes("3d")) kinds.push("3d-gen");
  if (output.includes("embedding")) kinds.push("embedding");
  if (output.includes("audio") && !output.includes("text")) kinds.push("tts");
  return kinds.length ? kinds : ["chat"];
}

export function parseModelsDev(json: Record<string, { id: string; models?: Record<string, ModelsDevModel> }>): ModelInfo[] {
  const out: ModelInfo[] = [];
  for (const [pid, p] of Object.entries(json)) {
    const provider = pid;
    for (const m of Object.values(p.models ?? {})) {
      const output = asModalities(m.modalities?.output);
      out.push({
        id: m.id,
        provider,
        name: m.name ?? m.id,
        family: m.family,
        contextWindow: m.limit?.context,
        maxOutput: m.limit?.output,
        inputModalities: asModalities(m.modalities?.input),
        outputModalities: output,
        toolCall: Boolean(m.tool_call),
        reasoning: Boolean(m.reasoning),
        openWeights: m.open_weights,
        cost: m.cost ? { input: m.cost.input, output: m.cost.output, cacheRead: m.cost.cache_read, cacheWrite: m.cost.cache_write } : undefined,
        kinds: kindsFor(output),
        releaseDate: m.release_date,
        source: "models.dev",
      });
    }
  }
  return out;
}

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  created?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string };
  top_provider?: { max_completion_tokens?: number | null };
  supported_parameters?: string[];
}

const perMillion = (s?: string) => (s === undefined || s === "" || Number(s) < 0 ? undefined : Number(s) * 1_000_000);

export function parseOpenRouter(json: { data?: OpenRouterModel[] }): ModelInfo[] {
  return (json.data ?? []).map((m) => {
    const output = asModalities(m.architecture?.output_modalities);
    const params = m.supported_parameters ?? [];
    return {
      id: m.id,
      provider: "openrouter",
      name: m.name ?? m.id,
      contextWindow: m.context_length,
      maxOutput: m.top_provider?.max_completion_tokens ?? undefined,
      inputModalities: asModalities(m.architecture?.input_modalities),
      outputModalities: output,
      toolCall: params.includes("tools"),
      reasoning: params.includes("reasoning") || params.includes("include_reasoning"),
      cost: {
        input: perMillion(m.pricing?.prompt),
        output: perMillion(m.pricing?.completion),
        cacheRead: perMillion(m.pricing?.input_cache_read),
        cacheWrite: perMillion(m.pricing?.input_cache_write),
      },
      kinds: kindsFor(output),
      releaseDate: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : undefined,
      source: "openrouter",
    } satisfies ModelInfo;
  });
}

const refOf = (m: ModelInfo) => `${m.provider}/${m.id}`;

// Merges sources: later sources add models; metadata fills gaps without overwriting
// better data (live listings rarely carry pricing, models.dev rarely lags on ids).
export function mergeModels(...sources: ModelInfo[][]): ModelInfo[] {
  const map = new Map<string, ModelInfo>();
  for (const src of sources)
    for (const m of src) {
      const prev = map.get(refOf(m));
      if (!prev) {
        map.set(refOf(m), m);
        continue;
      }
      map.set(refOf(m), {
        ...prev,
        name: prev.name !== prev.id ? prev.name : m.name,
        contextWindow: prev.contextWindow ?? m.contextWindow,
        maxOutput: prev.maxOutput ?? m.maxOutput,
        cost: prev.cost?.input !== undefined ? prev.cost : (m.cost ?? prev.cost),
        inputModalities: prev.inputModalities.length > m.inputModalities.length ? prev.inputModalities : m.inputModalities,
        toolCall: prev.toolCall || m.toolCall,
        reasoning: prev.reasoning || m.reasoning,
        family: prev.family ?? m.family,
        releaseDate: prev.releaseDate ?? m.releaseDate,
        source: m.source === "live" ? "live" : prev.source,
      });
    }
  return [...map.values()];
}

export interface ModelQuery {
  text?: string;
  provider?: string;
  kind?: ModelKind;
  input?: Modality;
  output?: Modality;
  toolCall?: boolean;
  reasoning?: boolean;
  openWeights?: boolean;
  minContext?: number;
  maxInputCost?: number;
  onlyConfigured?: boolean;
  sort?: "name" | "cost" | "context" | "release";
  limit?: number;
}

export function searchModels(models: ModelInfo[], q: ModelQuery, configured?: Set<string>): ModelInfo[] {
  const text = q.text?.toLowerCase();
  let out = models.filter(
    (m) =>
      (!text || refOf(m).toLowerCase().includes(text) || m.name.toLowerCase().includes(text)) &&
      (!q.provider || m.provider === q.provider) &&
      (!q.kind || m.kinds.includes(q.kind)) &&
      (!q.input || m.inputModalities.includes(q.input)) &&
      (!q.output || m.outputModalities.includes(q.output)) &&
      (q.toolCall === undefined || m.toolCall === q.toolCall) &&
      (q.reasoning === undefined || m.reasoning === q.reasoning) &&
      (q.openWeights === undefined || Boolean(m.openWeights) === q.openWeights) &&
      (!q.minContext || (m.contextWindow ?? 0) >= q.minContext) &&
      (q.maxInputCost === undefined || (m.cost?.input !== undefined && m.cost.input <= q.maxInputCost)) &&
      (!q.onlyConfigured || configured?.has(m.provider)),
  );
  const sorters: Record<string, (a: ModelInfo, b: ModelInfo) => number> = {
    name: (a, b) => refOf(a).localeCompare(refOf(b)),
    cost: (a, b) => (a.cost?.input ?? Infinity) - (b.cost?.input ?? Infinity),
    context: (a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0),
    release: (a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""),
  };
  out = out.sort(sorters[q.sort ?? "name"]);
  return q.limit ? out.slice(0, q.limit) : out;
}

export interface CatalogOptions {
  store?: TelemetryStore | null;
  registry?: ProviderRegistry;
  offline?: boolean;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
}

// The model catalog: every model ah knows about, from models.dev, OpenRouter,
// live provider listings and a built-in fallback table.
export class ModelCatalog {
  private models: ModelInfo[] = [];
  private loaded = false;
  readonly errors: string[] = [];

  constructor(private o: CatalogOptions = {}) {}

  private async cached(key: string, url: string): Promise<unknown | null> {
    const ttl = this.o.ttlMs ?? DAY;
    const hit = this.o.store?.cacheGet(key, ttl);
    if (hit) return JSON.parse(hit);
    if (this.o.offline) {
      const stale = this.o.store?.cacheGet(key, Number.POSITIVE_INFINITY);
      return stale ? JSON.parse(stale) : null;
    }
    try {
      const res = await (this.o.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      this.o.store?.cacheSet(key, text);
      return JSON.parse(text);
    } catch (err) {
      this.errors.push(`${key}: ${(err as Error).message}`);
      const stale = this.o.store?.cacheGet(key, Number.POSITIVE_INFINITY);
      return stale ? JSON.parse(stale) : null;
    }
  }

  async load(opts: { live?: boolean; refresh?: boolean } = {}): Promise<ModelInfo[]> {
    if (this.loaded && !opts.refresh) return this.models;
    if (opts.refresh) this.o = { ...this.o, ttlMs: 0 };
    const [md, or] = await Promise.all([this.cached("models.dev", MODELS_DEV_URL), this.cached("openrouter", OPENROUTER_URL)]);
    const live: ModelInfo[][] = [];
    if (opts.live && this.o.registry) {
      const results = await Promise.allSettled(
        this.o.registry
          .list()
          .filter((p) => p.listModels)
          .map(async (p) => {
            const key = `live:${p.key}`;
            const hit = !opts.refresh ? this.o.store?.cacheGet(key, 3_600_000) : null;
            if (hit) return JSON.parse(hit) as ModelInfo[];
            const ms = await p.listModels!(AbortSignal.timeout(10_000));
            this.o.store?.cacheSet(key, JSON.stringify(ms));
            return ms;
          }),
      );
      results.forEach((r) => (r.status === "fulfilled" ? live.push(r.value) : this.errors.push(`live: ${(r.reason as Error).message}`)));
    }
    this.models = mergeModels(
      md ? parseModelsDev(md as Parameters<typeof parseModelsDev>[0]) : [],
      or ? parseOpenRouter(or as Parameters<typeof parseOpenRouter>[0]) : [],
      ...live,
    );
    this.loaded = true;
    return this.models;
  }

  all(): ModelInfo[] {
    return this.models;
  }

  // Resolves "provider/model" to metadata. For gateways (openrouter/anthropic/x) also
  // tries the upstream provider's entry so pricing and limits are known.
  lookup(ref: string): ModelInfo | undefined {
    const exact = this.models.find((m) => refOf(m) === ref);
    if (exact) return exact;
    const [provider, ...rest] = ref.split("/");
    const id = rest.join("/");
    return (
      this.models.find((m) => m.provider === provider && m.id.split("/").pop() === id.split("/").pop()) ??
      this.models.find((m) => m.id === id) ??
      this.models.find((m) => m.id === id.split("/").pop())
    );
  }

  search(q: ModelQuery): ModelInfo[] {
    const configured = new Set(this.o.registry?.list().map((p) => p.key) ?? []);
    return searchModels(this.models, q, configured);
  }
}
