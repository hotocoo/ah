import { describe, expect, test } from "bun:test";
import { hubRepoFrom, modelCardDefaults, samplingFrom } from "../src/models/hf.ts";
import { TelemetryStore } from "../src/telemetry/store.ts";

describe("model card defaults", () => {
  test("hubRepoFrom parses ids, quant suffixes and HF cache paths", () => {
    expect(hubRepoFrom("ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF:Q8_0")).toBe("ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF");
    expect(hubRepoFrom("mlx-community/X-OptiQ-4bit")).toBe("mlx-community/X-OptiQ-4bit");
    expect(hubRepoFrom("/Users/a/.cache/huggingface/hub/models--ggml-org--X-GGUF/snapshots/abc/x.gguf")).toBe("ggml-org/X-GGUF");
    expect(hubRepoFrom("qwen3:4b")).toBeNull();
  });

  test("follows base_model when the quantised repo has no generation_config", async () => {
    const files: Record<string, unknown> = {
      "/api/models/q/gguf": { cardData: { base_model: ["orig/model"] } },
      "/orig/model/raw/main/generation_config.json": { temperature: 0.6, top_k: 20, top_p: 0.95 },
      "/orig/model/raw/main/chat_template.jinja": "{% if enable_thinking %}<think>{% endif %}",
    };
    const fake = (async (u: string | URL | Request) => {
      const p = new URL(String(u)).pathname;
      if (!(p in files)) return new Response("nf", { status: 404 });
      const v = files[p];
      return new Response(typeof v === "string" ? v : JSON.stringify(v));
    }) as typeof fetch;
    const store = new TelemetryStore(":memory:");
    const d = await modelCardDefaults("q/gguf", { store, fetchImpl: fake });
    expect(d).toEqual({ repo: "orig/model", sampling: { temperature: 0.6, topP: 0.95, topK: 20, minP: undefined }, templateThinkingToggle: true, controls: [] });
    // cached: no network the second time
    expect(await modelCardDefaults("q/gguf", { store, fetchImpl: (() => { throw new Error("net"); }) as unknown as typeof fetch })).toEqual(d);
  });

  test("samplingFrom ignores non-numbers", () => {
    expect(samplingFrom({ temperature: "hot", top_p: 0.9 })).toEqual({ temperature: undefined, topP: 0.9, topK: undefined, minP: undefined });
  });
});

describe("architecture facts", () => {
  test("hybrid models count only full-attention layers for the KV cache", async () => {
    const { archFromConfig } = await import("../src/models/hf.ts");
    const cfg = { text_config: { max_position_embeddings: 262144, num_hidden_layers: 32, num_key_value_heads: 4, num_attention_heads: 16, head_dim: 256, layer_types: [...Array(24).fill("linear_attention"), ...Array(8).fill("full_attention")] } };
    expect(archFromConfig(cfg)).toEqual({ trainedContext: 262144, kv: { layers: 8, kvHeads: 4, headDim: 256 } });
    expect(archFromConfig({ num_hidden_layers: 28, num_attention_heads: 16, hidden_size: 2048, max_position_embeddings: 40960 })).toEqual({ trainedContext: 40960, kv: { layers: 28, kvHeads: 16, headDim: 128 } });
  });
});
