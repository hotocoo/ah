import type { ChatRequest, ContentBlock, Message, ModelInfo, Modality, StreamEvent, Usage } from "../core/types.ts";
import { guessKinds } from "./openai-compat.ts";
import {
  ensureOk,
  sseData,
  type EmbedRequest,
  type GeneratedImage,
  type ImageGenRequest,
  type Provider,
  type ProviderCapabilities,
} from "./provider.ts";

// Native Google Gemini adapter (Generative Language API v1beta).
type GPart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown> } };
interface GContent {
  role: "user" | "model";
  parts: GPart[];
}

export function toGeminiContents(messages: Message[]): GContent[] {
  const names = new Map<string, string>();
  return messages.map((m) => {
    const parts: GPart[] = [];
    for (const b of m.content) {
      if (b.type === "text") parts.push({ text: b.text });
      else if (b.type === "image") parts.push({ inlineData: { mimeType: b.mediaType, data: b.data } });
      else if (b.type === "tool_call") {
        names.set(b.id, b.name);
        parts.push({ functionCall: { name: b.name, args: b.input }, ...(b.signature ? { thoughtSignature: b.signature } : {}) });
      } else if (b.type === "tool_result")
        parts.push({
          functionResponse: {
            name: names.get(b.toolCallId) ?? "tool",
            response: b.isError ? { error: b.content } : { content: b.content },
          },
        });
    }
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });
}

// Gemini's schema dialect rejects some JSON Schema keys; strip them recursively.
function cleanSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties" || k === "$schema" || k === "default") continue;
    out[k] = cleanSchema(v);
  }
  return out;
}

export class GeminiProvider implements Provider {
  readonly kind = "gemini";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    streaming: true,
    tools: true,
    vision: true,
    embeddings: true,
    imageGen: true,
    modelListing: true,
  };

  constructor(
    readonly key = "google",
    private apiKey = "",
    private baseURL = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  private headers() {
    return { "content-type": "application/json", "x-goog-api-key": this.apiKey };
  }

  buildBody(req: ChatRequest): Record<string, unknown> {
    const generationConfig: Record<string, unknown> = { maxOutputTokens: req.maxTokens };
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.reasoning) {
      generationConfig.thinkingConfig =
        req.reasoning === "off"
          ? { thinkingBudget: 0 }
          : { includeThoughts: true, thinkingBudget: { low: 1024, medium: 8192, high: 24576, max: -1 }[req.reasoning] };
    }
    return {
      contents: toGeminiContents(req.messages),
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      ...(req.tools.length
        ? {
            tools: [
              {
                functionDeclarations: req.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: cleanSchema(t.inputSchema),
                })),
              },
            ],
          }
        : {}),
      generationConfig,
    };
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const res = await ensureOk(
      await fetch(`${this.baseURL}/models/${req.model}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(this.buildBody(req)),
        signal: req.signal,
      }),
      this.key,
    );
    let text = "";
    let finish = "STOP";
    const calls: ContentBlock[] = [];
    const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
    let n = 0;
    for await (const data of sseData(res.body!)) {
      const chunk = JSON.parse(data) as {
        candidates?: { content?: { parts?: GPart[] }; finishReason?: string }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
      };
      const u = chunk.usageMetadata;
      if (u) {
        usage.inputTokens = u.promptTokenCount ?? 0;
        usage.outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
        usage.cacheReadTokens = u.cachedContentTokenCount ?? 0;
        usage.reasoningTokens = u.thoughtsTokenCount ?? 0;
      }
      const cand = chunk.candidates?.[0];
      if (cand?.finishReason) finish = cand.finishReason;
      for (const p of cand?.content?.parts ?? []) {
        if ("functionCall" in p) {
          const id = `gemini_${n++}`;
          yield { type: "tool_call_start", id, name: p.functionCall.name };
          yield { type: "tool_call_delta", id, partialJson: JSON.stringify(p.functionCall.args ?? {}) };
          calls.push({ type: "tool_call", id, name: p.functionCall.name, input: p.functionCall.args ?? {}, signature: p.thoughtSignature });
        } else if ("text" in p) {
          if (p.thought) yield { type: "thinking_delta", text: p.text };
          else {
            text += p.text;
            yield { type: "text_delta", text: p.text };
          }
        }
      }
    }
    const content: ContentBlock[] = [...(text ? [{ type: "text" as const, text }] : []), ...calls];
    const stopReason = calls.length
      ? "tool_use"
      : finish === "MAX_TOKENS"
        ? "max_tokens"
        : finish === "SAFETY" || finish === "PROHIBITED_CONTENT"
          ? "refusal"
          : "end_turn";
    yield { type: "done", message: { role: "assistant", content }, stopReason, usage };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    let pageToken = "";
    do {
      const res = await ensureOk(
        await fetch(`${this.baseURL}/models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`, { headers: this.headers(), signal }),
        this.key,
      );
      const j = (await res.json()) as {
        models?: { name: string; displayName?: string; inputTokenLimit?: number; outputTokenLimit?: number; supportedGenerationMethods?: string[]; thinking?: boolean }[];
        nextPageToken?: string;
      };
      for (const m of j.models ?? []) {
        const id = m.name.replace(/^models\//, "");
        const methods = m.supportedGenerationMethods ?? [];
        const kinds: ModelInfo["kinds"] = methods.includes("embedContent") ? ["embedding"] : methods.includes("predict") ? ["image-gen"] : guessKinds(id);
        const imageOut = /image/.test(id) && !methods.includes("embedContent");
        out.push({
          id,
          provider: this.key,
          name: m.displayName ?? id,
          contextWindow: m.inputTokenLimit,
          maxOutput: m.outputTokenLimit,
          inputModalities: ["text", "image", "audio", "video", "pdf"] as Modality[],
          outputModalities: imageOut ? ["text", "image"] : kinds[0] === "embedding" ? ["embedding"] : ["text"],
          toolCall: methods.includes("generateContent"),
          reasoning: Boolean(m.thinking),
          kinds: imageOut && !kinds.includes("image-gen") ? [...kinds, "image-gen"] : [...kinds],
          source: "live",
        });
      }
      pageToken = j.nextPageToken ?? "";
    } while (pageToken);
    return out;
  }

  // Imagen models use :predict; Gemini image models return inline image parts.
  async generateImage(req: ImageGenRequest): Promise<GeneratedImage[]> {
    if (req.model.startsWith("imagen")) {
      const res = await ensureOk(
        await fetch(`${this.baseURL}/models/${req.model}:predict`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ instances: [{ prompt: req.prompt }], parameters: { sampleCount: req.n ?? 1 } }),
          signal: req.signal,
        }),
        this.key,
      );
      const j = (await res.json()) as { predictions?: { bytesBase64Encoded: string; mimeType?: string }[] };
      return (j.predictions ?? []).map((p) => ({ mediaType: p.mimeType ?? "image/png", data: p.bytesBase64Encoded }));
    }
    const res = await ensureOk(
      await fetch(`${this.baseURL}/models/${req.model}:generateContent`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        signal: req.signal,
      }),
      this.key,
    );
    const j = (await res.json()) as { candidates?: { content?: { parts?: GPart[] } }[] };
    const parts = j.candidates?.[0]?.content?.parts ?? [];
    return parts
      .filter((p): p is Extract<GPart, { inlineData: unknown }> => "inlineData" in p)
      .map((p) => ({ mediaType: p.inlineData.mimeType, data: p.inlineData.data }));
  }

  async embed(req: EmbedRequest): Promise<number[][]> {
    const res = await ensureOk(
      await fetch(`${this.baseURL}/models/${req.model}:batchEmbedContents`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          requests: req.input.map((t) => ({ model: `models/${req.model}`, content: { parts: [{ text: t }] } })),
        }),
        signal: req.signal,
      }),
      this.key,
    );
    return ((await res.json()) as { embeddings: { values: number[] }[] }).embeddings.map((e) => e.values);
  }
}
