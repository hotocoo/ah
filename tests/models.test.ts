import { describe, expect, test } from "bun:test";
import { mergeModels, ModelCatalog, parseModelsDev, parseOpenRouter, searchModels } from "../src/models/catalog.ts";
import { TelemetryStore } from "../src/telemetry/store.ts";

const modelsDev = {
  anthropic: {
    id: "anthropic",
    models: {
      "claude-opus-5": {
        id: "claude-opus-5",
        name: "Claude Opus 5",
        reasoning: true,
        tool_call: true,
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        limit: { context: 1_000_000, output: 128_000 },
        cost: { input: 5, output: 25, cache_read: 0.5 },
        release_date: "2026-04-01",
      },
    },
  },
  togetherai: {
    id: "togetherai",
    models: {
      "flux-pro": { id: "flux-pro", modalities: { input: ["text"], output: ["image"] } },
      "m2-bert-embed": { id: "m2-bert-embed", modalities: { input: ["text"], output: ["embedding"] } },
    },
  },
};

const openRouter = {
  data: [
    {
      id: "anthropic/claude-opus-5",
      name: "Anthropic: Claude Opus 5",
      context_length: 1_000_000,
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      pricing: { prompt: "0.000005", completion: "0.000025", input_cache_read: "0.0000005" },
      top_provider: { max_completion_tokens: 128000 },
      supported_parameters: ["tools", "reasoning"],
    },
  ],
};

describe("catalog parsing", () => {
  test("models.dev maps fields, aliases providers and classifies kinds", () => {
    const ms = parseModelsDev(modelsDev);
    const opus = ms.find((m) => m.id === "claude-opus-5")!;
    expect(opus).toMatchObject({ provider: "anthropic", contextWindow: 1_000_000, maxOutput: 128_000, toolCall: true, kinds: ["chat"] });
    expect(opus.cost).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: undefined });
    expect(opus.inputModalities).toContain("pdf");
    expect(ms.find((m) => m.id === "flux-pro")).toMatchObject({ provider: "togetherai", kinds: ["image-gen"] });
    expect(ms.find((m) => m.id === "m2-bert-embed")!.kinds).toEqual(["embedding"]);
  });

  test("openrouter converts per-token string prices to per-million", () => {
    const [m] = parseOpenRouter(openRouter);
    expect(m!.cost!.input).toBeCloseTo(5);
    expect(m!.cost!.output).toBeCloseTo(25);
    expect(m!.cost!.cacheRead).toBeCloseTo(0.5);
    expect(m!.toolCall).toBe(true);
    expect(m!.maxOutput).toBe(128000);
  });

  test("merge keeps pricing from catalog when a live listing lacks it", () => {
    const [md] = parseModelsDev(modelsDev);
    const live = { ...md!, name: md!.id, cost: undefined, source: "live" as const, contextWindow: undefined };
    const [merged] = mergeModels([md!], [live]);
    expect(merged!.cost!.input).toBe(5);
    expect(merged!.contextWindow).toBe(1_000_000);
    expect(merged!.source).toBe("live");
  });

  test("search filters and sorts", () => {
    const ms = [...parseModelsDev(modelsDev), ...parseOpenRouter(openRouter)];
    expect(searchModels(ms, { kind: "image-gen" }).map((m) => m.id)).toEqual(["flux-pro"]);
    expect(searchModels(ms, { text: "opus", provider: "openrouter" })).toHaveLength(1);
    expect(searchModels(ms, { input: "pdf" })).toHaveLength(1);
    expect(searchModels(ms, { minContext: 500_000, sort: "cost" })[0]!.cost!.input).toBeCloseTo(5);
    expect(searchModels(ms, { onlyConfigured: true }, new Set(["togetherai"]))).toHaveLength(2);
  });
});

describe("ModelCatalog", () => {
  const fakeFetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("models.dev")) return new Response(JSON.stringify(modelsDev));
    if (u.includes("openrouter")) return new Response(JSON.stringify(openRouter));
    return new Response("", { status: 404 });
  }) as typeof fetch;

  test("loads, caches in the store and resolves gateway refs", async () => {
    const store = new TelemetryStore(":memory:");
    const cat = new ModelCatalog({ store, fetchImpl: fakeFetch });
    await cat.load();
    expect(cat.lookup("anthropic/claude-opus-5")!.cost!.input).toBe(5);
    expect(cat.lookup("openrouter/anthropic/claude-opus-5")!.provider).toBe("openrouter");
    expect(store.cacheGet("models.dev", 60_000)).not.toBeNull();
    // offline reload uses cache without fetching
    const offline = new ModelCatalog({ store, offline: true, fetchImpl: (() => { throw new Error("no net"); }) as unknown as typeof fetch });
    await offline.load();
    expect(offline.lookup("togetherai/flux-pro")).toBeDefined();
  });

  test("records errors when the network fails", async () => {
    const cat = new ModelCatalog({ fetchImpl: (async () => new Response("", { status: 500 })) as unknown as typeof fetch });
    await cat.load();
    expect(cat.errors.length).toBe(2);
    expect(cat.all()).toEqual([]);
  });
});
