import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { parseModelRef } from "../src/config.ts";
import type { Message } from "../src/core/types.ts";
import { encodePng } from "../src/media/png.ts";
import { AnthropicProvider, toAnthropicMessages } from "../src/providers/anthropic.ts";
import { GeminiProvider, toGeminiContents } from "../src/providers/gemini.ts";
import { MockProvider } from "../src/providers/mock.ts";
import { toOllamaMessages } from "../src/providers/ollama.ts";
import { guessKinds, OpenAICompatProvider, toOpenAIMessages } from "../src/providers/openai-compat.ts";
import { collect, ndjson, parseToolArgs, sseData } from "../src/providers/provider.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { defaultConfig } from "../src/config.ts";

const convo: Message[] = [
  { role: "user", content: [{ type: "text", text: "fix the bug" }] },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Reading file." },
      { type: "tool_call", id: "call_1", name: "read_file", input: { path: "a.ts" } },
    ],
  },
  { role: "user", content: [{ type: "tool_result", toolCallId: "call_1", content: "export const a = 1;" }] },
];

const streamOf = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      // Split at awkward boundaries to exercise buffering.
      for (let i = 0; i < text.length; i += 7) c.enqueue(enc.encode(text.slice(i, i + 7)));
      c.close();
    },
  });

describe("message converters", () => {
  test("anthropic maps tool_call and tool_result ids", () => {
    const out = toAnthropicMessages(convo);
    expect(out[1]!.content).toEqual([
      { type: "text", text: "Reading file." },
      { type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } },
    ]);
    expect(out[2]!.content).toEqual([
      { type: "tool_result", tool_use_id: "call_1", content: "export const a = 1;", is_error: undefined },
    ]);
  });

  test("anthropic drops unsigned thinking blocks", () => {
    const out = toAnthropicMessages([{ role: "assistant", content: [{ type: "thinking", text: "hmm" }] }]);
    expect(out[0]!.content).toEqual([]);
  });

  test("openai emits system, tool_calls with JSON args, and tool role messages", () => {
    const out = toOpenAIMessages("sys", convo);
    expect(out[0]).toEqual({ role: "system", content: "sys" });
    expect(out[2]).toEqual({
      role: "assistant",
      content: "Reading file.",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }],
    });
    expect(out[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "export const a = 1;" });
  });

  test("openai encodes images as data URLs", () => {
    const out = toOpenAIMessages("", [
      { role: "user", content: [{ type: "text", text: "see" }, { type: "image", mediaType: "image/png", data: "AAA" }] },
    ]);
    expect(out[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "see" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
      ],
    });
  });

  test("ollama resolves tool_name from the originating call", () => {
    const out = toOllamaMessages("", convo);
    expect(out[1]!.tool_calls).toEqual([{ function: { name: "read_file", arguments: { path: "a.ts" } } }]);
    expect(out[2]).toEqual({ role: "tool", content: "export const a = 1;", tool_name: "read_file" });
  });

  test("gemini maps roles and functionResponse names, keeps thought signatures", () => {
    const withSig: Message[] = [
      convo[0]!,
      { role: "assistant", content: [{ type: "tool_call", id: "g1", name: "grep", input: { q: "x" }, signature: "SIG" }] },
      { role: "user", content: [{ type: "tool_result", toolCallId: "g1", content: "none", isError: true }] },
    ];
    const out = toGeminiContents(withSig);
    expect(out[1]).toEqual({ role: "model", parts: [{ functionCall: { name: "grep", args: { q: "x" } }, thoughtSignature: "SIG" }] });
    expect(out[2]).toEqual({ role: "user", parts: [{ functionResponse: { name: "grep", response: { error: "none" } } }] });
  });
});

describe("request builders", () => {
  const req = {
    model: "m",
    system: "s",
    messages: convo,
    tools: [{ name: "t", description: "d", inputSchema: { type: "object", additionalProperties: false } }],
    maxTokens: 1000,
    reasoning: "high" as const,
  };

  test("openai-compatible defaults to max_tokens and no reasoning param", () => {
    const body = new OpenAICompatProvider("x", { baseURL: "http://h" }).buildBody(req);
    expect(body.max_tokens).toBe(1000);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.stream_options).toBeUndefined();
  });

  test("openai preset uses max_completion_tokens and reasoning_effort", () => {
    const body = new OpenAICompatProvider("openai", {
      baseURL: "http://h",
      maxTokensParam: "max_completion_tokens",
      reasoningParam: "openai",
      streamUsage: true,
    }).buildBody(req);
    expect(body.max_completion_tokens).toBe(1000);
    expect(body.reasoning_effort).toBe("high");
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  test("openrouter nests reasoning effort", () => {
    const body = new OpenAICompatProvider("or", { baseURL: "http://h", reasoningParam: "openrouter" }).buildBody(req);
    expect(body.reasoning).toEqual({ effort: "high" });
  });

  test("anthropic uses adaptive thinking + effort on current models, fallbacks on opus-5", () => {
    const p = new AnthropicProvider("anthropic", { apiKey: "x" });
    const { params, betas } = p.buildParams({ ...req, model: "claude-opus-5" });
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.fallbacks).toBe("default");
    expect(betas).toContain("server-side-fallback-2026-07-01");
    expect((params.tools![0] as { eager_input_streaming?: boolean }).eager_input_streaming).toBe(true);
  });

  test("anthropic uses budget_tokens on legacy models and clamps it", () => {
    const p = new AnthropicProvider("anthropic", { apiKey: "x" });
    const { params, betas } = p.buildParams({ ...req, model: "claude-haiku-4-5", maxTokens: 4096 });
    expect(params.thinking).toEqual({ type: "enabled", budget_tokens: 3072 });
    expect(betas).toEqual([]);
    const small = p.buildParams({ ...req, model: "claude-haiku-4-5", maxTokens: 1500 });
    expect(small.params.thinking).toBeUndefined();
  });

  test("gemini strips unsupported schema keys", () => {
    const body = new GeminiProvider("g", "k").buildBody(req) as { tools: { functionDeclarations: { parameters: object }[] }[] };
    expect(body.tools[0]!.functionDeclarations[0]!.parameters).toEqual({ type: "object" });
  });
});

describe("stream parsing", () => {
  test("sseData joins multi-line data and handles CRLF", async () => {
    const out: string[] = [];
    for await (const d of sseData(streamOf('event: x\r\ndata: {"a":\r\ndata: 1}\r\n\r\ndata: [DONE]\n\n'))) out.push(d);
    expect(out).toEqual(['{"a":\n1}', "[DONE]"]);
  });

  test("ndjson parses split lines and trailing record", async () => {
    const out: unknown[] = [];
    for await (const d of ndjson(streamOf('{"a":1}\n{"b":2}\n{"c":3}'))) out.push(d);
    expect(out).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  test("parseToolArgs", () => {
    expect(parseToolArgs("")).toEqual({});
    expect(parseToolArgs('{"x":1}')).toEqual({ x: 1 });
    expect(parseToolArgs("[1]")).toBeNull();
    expect(parseToolArgs('{"x":')).toBeNull();
  });

  test("openai-compatible stream assembles tool calls and usage", async () => {
    const sse = [
      { choices: [{ delta: { content: "Hi" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "ls", arguments: '{"pa' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"."}' } }] }, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } } },
    ]
      .map((c) => `data: ${JSON.stringify(c)}\n\n`)
      .join("") + "data: [DONE]\n\n";
    const server = Bun.serve({ port: 0, fetch: () => new Response(sse, { headers: { "content-type": "text/event-stream" } }) });
    try {
      const p = new OpenAICompatProvider("t", { baseURL: `http://localhost:${server.port}` });
      const r = await collect(p.stream({ model: "m", system: "", messages: convo, tools: [], maxTokens: 10 }));
      expect(r.stopReason).toBe("tool_use");
      expect(r.message.content).toEqual([
        { type: "text", text: "Hi" },
        { type: "tool_call", id: "c1", name: "ls", input: { path: "." } },
      ]);
      expect(r.usage.inputTokens).toBe(10);
      expect(r.usage.cacheReadTokens).toBe(4);
    } finally {
      server.stop(true);
    }
  });

  test("openai-compatible stream rejects invalid tool JSON with invalid_tool_json", async () => {
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c", function: { name: "x", arguments: "{bad" } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`;
    const server = Bun.serve({ port: 0, fetch: () => new Response(sse) });
    try {
      const p = new OpenAICompatProvider("t", { baseURL: `http://localhost:${server.port}` });
      await expect(collect(p.stream({ model: "m", system: "", messages: convo, tools: [], maxTokens: 10 }))).rejects.toMatchObject({
        code: "invalid_tool_json",
        retryable: true,
      });
    } finally {
      server.stop(true);
    }
  });
});

describe("mock provider", () => {
  test("replays script turns by assistant-message count", async () => {
    const m = new MockProvider({ script: [{ toolCalls: [{ name: "ls", input: {} }] }, { text: "finished" }] });
    const req = { model: "scripted", system: "", messages: [convo[0]!], tools: [], maxTokens: 10 };
    const r1 = await collect(m.stream(req));
    expect(r1.stopReason).toBe("tool_use");
    const r2 = await collect(m.stream({ ...req, messages: convo }));
    expect(r2.stopReason).toBe("end_turn");
    expect(r2.message.content).toEqual([{ type: "text", text: "finished" }]);
  });

  test("fails first N calls with retryable ProviderError", async () => {
    const m = new MockProvider({ failTimes: 1 });
    const req = { model: "echo", system: "", messages: convo, tools: [], maxTokens: 10 };
    await expect(collect(m.stream(req))).rejects.toMatchObject({ retryable: true, status: 503 });
    expect((await collect(m.stream(req))).stopReason).toBe("end_turn");
  });
});

describe("misc", () => {
  test("parseModelRef splits at first slash", () => {
    expect(parseModelRef("openrouter/anthropic/claude-opus-5")).toEqual({ provider: "openrouter", model: "anthropic/claude-opus-5" });
    expect(() => parseModelRef("nope")).toThrow();
  });

  test("guessKinds", () => {
    expect(guessKinds("text-embedding-3-large")).toEqual(["embedding"]);
    expect(guessKinds("gpt-image-1")).toEqual(["image-gen"]);
    expect(guessKinds("whisper-1")).toEqual(["stt"]);
    expect(guessKinds("gpt-5")).toEqual(["chat"]);
  });

  test("encodePng writes a valid header and decodable pixels", () => {
    const png = encodePng(2, 1, (x) => [x * 255, 0, 0, 255]);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(1);
    const idatLen = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect([...raw]).toEqual([0, 0, 0, 0, 255, 255, 0, 0, 255]);
  });

  test("registry registers keyless local providers and skips unkeyed cloud ones", () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const reg = ProviderRegistry.fromConfig(defaultConfig());
    expect(reg.has("mock")).toBe(true);
    expect(reg.has("ollama")).toBe(true);
    expect(reg.has("openai")).toBe(false);
    expect(() => reg.get("openai")).toThrow(/OPENAI_API_KEY/);
    if (saved) process.env.OPENAI_API_KEY = saved;
  });
});
