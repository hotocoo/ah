import type { ChatRequest, ContentBlock, Message, ModelInfo, RuntimeTimings, StopReason, StreamEvent, Usage } from "../core/types.ts";
import {
  ensureOk,
  parseToolArgs,
  ProviderError,
  sseData,
  type EmbedRequest,
  type GeneratedImage,
  type ImageGenRequest,
  type Provider,
  type ProviderCapabilities,
} from "./provider.ts";

// Adapter for the OpenAI Chat Completions wire format. Covers OpenAI itself and every
// compatible gateway (OpenRouter, Groq, Together, DeepSeek, xAI, Mistral, Fireworks,
// Cerebras, LM Studio, vLLM, llama.cpp server, Hugging Face router, ...).
export interface OpenAICompatOptions {
  baseURL: string;
  apiKey?: string;
  headers?: Record<string, string>;
  imageGen?: boolean;
  embeddings?: boolean;
  // Wire-format divergences between compatible servers. These start from defaults and
  // are corrected automatically when a server rejects a parameter (see adaptWire).
  wire?: Partial<WireFormat>;
  onWireChange?: (w: WireFormat) => void;
  // Facts about the served model learned during runtime discovery.
  modelMeta?: { contextWindow?: number; toolCall?: boolean; vision?: boolean };
}

export interface WireFormat {
  maxTokensParam: "max_tokens" | "max_completion_tokens";
  reasoningParam: "reasoning_effort" | "reasoning" | "none";
  streamUsage: boolean;
}

export const DEFAULT_WIRE: WireFormat = { maxTokensParam: "max_tokens", reasoningParam: "reasoning_effort", streamUsage: true };

// Given a 400 error body, returns a corrected wire format, or null if the error is
// not about a parameter we control.
export function adaptWire(w: WireFormat, body: string): WireFormat | null {
  const b = body.toLowerCase();
  const mentions = (p: string) => b.includes(p);
  if (mentions("max_completion_tokens") && w.maxTokensParam === "max_tokens") return { ...w, maxTokensParam: "max_completion_tokens" };
  if (mentions("max_completion_tokens") && w.maxTokensParam === "max_completion_tokens") return { ...w, maxTokensParam: "max_tokens" };
  if (mentions("max_tokens") && w.maxTokensParam === "max_tokens") return { ...w, maxTokensParam: "max_completion_tokens" };
  if (mentions("stream_options") && w.streamUsage) return { ...w, streamUsage: false };
  if (mentions("reasoning_effort") && w.reasoningParam === "reasoning_effort") return { ...w, reasoningParam: "reasoning" };
  if (mentions("reasoning") && w.reasoningParam !== "none") return { ...w, reasoningParam: "none" };
  return null;
}

type OAMessage =
  | { role: "system" | "user"; content: string | OAPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: OAToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type OAPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
interface OAToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export function toOpenAIMessages(system: string, messages: Message[]): OAMessage[] {
  const out: OAMessage[] = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      const calls = m.content
        .filter((b) => b.type === "tool_call")
        .map((b) => {
          const c = b as Extract<ContentBlock, { type: "tool_call" }>;
          return { id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input) } };
        });
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // Tool results become separate `tool` messages; remaining parts form a user message.
    const parts: OAPart[] = [];
    for (const b of m.content) {
      if (b.type === "tool_result")
        out.push({ role: "tool", tool_call_id: b.toolCallId, content: b.isError ? `ERROR: ${b.content}` : b.content });
      else if (b.type === "text") parts.push({ type: "text", text: b.text });
      else if (b.type === "image") parts.push({ type: "image_url", image_url: { url: `data:${b.mediaType};base64,${b.data}` } });
    }
    if (parts.length) {
      const onlyText = parts.every((p) => p.type === "text");
      out.push({ role: "user", content: onlyText ? parts.map((p) => (p as { text: string }).text).join("\n") : parts });
    }
  }
  return out;
}

const mapFinish = (r: string | null | undefined): StopReason => {
  switch (r) {
    case "stop":
      return "end_turn";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return r ? "other" : "end_turn";
  }
};

export class OpenAICompatProvider implements Provider {
  readonly kind = "openai-compatible";
  readonly capabilities: ProviderCapabilities;
  wire: WireFormat;

  constructor(
    readonly key: string,
    private opts: OpenAICompatOptions,
  ) {
    this.wire = { ...DEFAULT_WIRE, ...opts.wire };
    this.capabilities = {
      chat: true,
      streaming: true,
      tools: true,
      vision: true,
      embeddings: opts.embeddings ?? true,
      imageGen: opts.imageGen ?? false,
      modelListing: true,
    };
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      ...this.opts.headers,
    };
  }

  private url(path: string): string {
    return `${this.opts.baseURL.replace(/\/$/, "")}${path}`;
  }

  buildBody(req: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAIMessages(req.system, req.messages),
      stream: true,
      [this.wire.maxTokensParam]: req.maxTokens,
    };
    if (this.wire.streamUsage) body.stream_options = { include_usage: true };
    if (req.tools.length)
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    if (req.temperature !== undefined) body.temperature = req.temperature;
    const effort = req.reasoning && req.reasoning !== "off" ? (req.reasoning === "max" ? "high" : req.reasoning) : undefined;
    if (effort && this.wire.reasoningParam === "reasoning_effort") body.reasoning_effort = effort;
    if (effort && this.wire.reasoningParam === "reasoning") body.reasoning = { effort };
    return body;
  }

  // POSTs a chat request, adapting the wire format up to 3 times when the server
  // rejects one of our parameters with HTTP 400.
  private async post(req: ChatRequest): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url("/chat/completions"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(this.buildBody(req)),
        signal: req.signal,
      });
      if (res.status !== 400 || attempt >= 3) return ensureOk(res, this.key);
      const body = await res.text();
      const next = adaptWire(this.wire, body);
      if (!next) return ensureOk(new Response(body, { status: 400 }), this.key);
      this.wire = next;
      this.opts.onWireChange?.(next);
    }
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const res = await this.post(req);
    let timings: RuntimeTimings | undefined;
    let text = "";
    let finish: string | null = null;
    const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const data of sseData(res.body!)) {
      if (data === "[DONE]") break;
      const chunk = JSON.parse(data) as {
        choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string | Record<string, unknown> } }[] }; finish_reason?: string | null }[];
        timings?: { cache_n?: number; prompt_n?: number; prompt_ms?: number; prompt_per_second?: number; predicted_n?: number; predicted_ms?: number; predicted_per_second?: number };
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
      };
      if (chunk.timings) {
        const t = chunk.timings;
        timings = {
          promptTokens: t.prompt_n,
          promptMs: t.prompt_ms,
          prefillTokensPerSec: t.prompt_per_second,
          decodeTokens: t.predicted_n,
          decodeMs: t.predicted_ms,
          decodeTokensPerSec: t.predicted_per_second,
          cachedTokens: t.cache_n,
        };
      }
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
        usage.outputTokens = chunk.usage.completion_tokens ?? 0;
        usage.cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
        usage.reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const d = choice.delta ?? {};
      const reasoning = d.reasoning_content ?? d.reasoning;
      if (reasoning) yield { type: "thinking_delta", text: reasoning };
      if (d.content) {
        text += d.content;
        yield { type: "text_delta", text: d.content };
      }
      for (const tc of d.tool_calls ?? []) {
        let entry = calls.get(tc.index);
        if (!entry) {
          entry = { id: tc.id ?? `call_${tc.index}`, name: tc.function?.name ?? "", args: "" };
          calls.set(tc.index, entry);
          yield { type: "tool_call_start", id: entry.id, name: entry.name };
        }
        // Some servers (llama.cpp) send arguments as an object instead of a JSON string.
        const args = tc.function?.arguments;
        const piece = typeof args === "string" ? args : args ? JSON.stringify(args) : "";
        if (piece) {
          entry.args += piece;
          yield { type: "tool_call_delta", id: entry.id, partialJson: piece };
        }
      }
    }
    const content: ContentBlock[] = text ? [{ type: "text", text }] : [];
    for (const c of calls.values()) {
      const input = parseToolArgs(c.args);
      if (!input)
        throw new ProviderError(`${this.key}: tool ${c.name} arguments are not valid JSON`, this.key, undefined, true, "invalid_tool_json");
      content.push({ type: "tool_call", id: c.id, name: c.name, input });
    }
    const stopReason = calls.size && (finish === null || finish === "stop") ? "tool_use" : mapFinish(finish);
    // llama.cpp reports prompt tokens only in timings when usage is absent.
    if (!usage.inputTokens && timings?.promptTokens) usage.inputTokens = (timings.promptTokens ?? 0) + (timings.cachedTokens ?? 0);
    if (!usage.outputTokens && timings?.decodeTokens) usage.outputTokens = timings.decodeTokens;
    if (!usage.cacheReadTokens && timings?.cachedTokens) usage.cacheReadTokens = timings.cachedTokens;
    yield { type: "done", message: { role: "assistant", content }, stopReason, usage, timings };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await ensureOk(await fetch(this.url("/models"), { headers: this.headers(), signal }), this.key);
    const json = (await res.json()) as { data?: { id: string; context_length?: number; owned_by?: string }[] };
    const meta = this.opts.modelMeta ?? {};
    return (json.data ?? []).map((m) => ({
      id: m.id,
      provider: this.key,
      name: m.id,
      contextWindow: m.context_length ?? meta.contextWindow,
      inputModalities: meta.vision ? ["text", "image"] : ["text"],
      outputModalities: ["text"],
      toolCall: meta.toolCall ?? true,
      reasoning: false,
      kinds: ["chat"],
      source: "live" as const,
    }));
  }

  async generateImage(req: ImageGenRequest): Promise<GeneratedImage[]> {
    const res = await ensureOk(
      await fetch(this.url("/images/generations"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ model: req.model, prompt: req.prompt, n: req.n ?? 1, size: req.size ?? "1024x1024" }),
        signal: req.signal,
      }),
      this.key,
    );
    const json = (await res.json()) as { data: { b64_json?: string; url?: string; revised_prompt?: string }[] };
    return Promise.all(
      json.data.map(async (d) => {
        if (d.b64_json) return { mediaType: "image/png", data: d.b64_json, revisedPrompt: d.revised_prompt };
        const img = await ensureOk(await fetch(d.url!, { signal: req.signal }), this.key);
        const type = img.headers.get("content-type") ?? "image/png";
        return { mediaType: type, data: Buffer.from(await img.arrayBuffer()).toString("base64"), revisedPrompt: d.revised_prompt };
      }),
    );
  }

  async embed(req: EmbedRequest): Promise<number[][]> {
    const res = await ensureOk(
      await fetch(this.url("/embeddings"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ model: req.model, input: req.input }),
        signal: req.signal,
      }),
      this.key,
    );
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
}
