import type { ChatRequest, ChatResult, ModelInfo, StreamEvent } from "../core/types.ts";

export interface ProviderCapabilities {
  chat: boolean;
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  embeddings: boolean;
  imageGen: boolean;
  modelListing: boolean;
}

export interface ImageGenRequest {
  model: string;
  prompt: string;
  size?: string; // e.g. 1024x1024
  n?: number;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  mediaType: string;
  data: string; // base64
  revisedPrompt?: string;
}

export interface EmbedRequest {
  model: string;
  input: string[];
  signal?: AbortSignal;
}

export interface Provider {
  readonly key: string; // unique key, e.g. "anthropic", "openrouter"
  readonly kind: string; // adapter family, e.g. "anthropic", "openai-compatible"
  readonly capabilities: ProviderCapabilities;
  // Streams a chat completion. Must yield exactly one `done` event at the end on success.
  stream(req: ChatRequest): AsyncIterable<StreamEvent>;
  listModels?(signal?: AbortSignal): Promise<ModelInfo[]>;
  generateImage?(req: ImageGenRequest): Promise<GeneratedImage[]>;
  embed?(req: EmbedRequest): Promise<number[][]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly retryable = false,
    readonly code?: "invalid_tool_json" | "context_overflow",
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

// Collects a stream into a single result. Throws if the provider never emitted `done`.
export async function collect(
  stream: AsyncIterable<StreamEvent>,
  onEvent?: (e: StreamEvent) => void,
): Promise<ChatResult> {
  for await (const ev of stream) {
    onEvent?.(ev);
    if (ev.type === "done") return { message: ev.message, stopReason: ev.stopReason, usage: ev.usage };
  }
  throw new Error("provider stream ended without a done event");
}

export const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 409 || status === 429 || status >= 500;

// Error-body patterns that mean the request exceeded the model's context window.
export const CONTEXT_OVERFLOW = /context[_ ]length|maximum context|context window|too many tokens|prompt is too long|exceeds the (maximum|context)|input token count/i;

// Throws a ProviderError for non-2xx responses, keeping the body for diagnosis.
export async function ensureOk(res: Response, provider: string): Promise<Response> {
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  const overflow = res.status === 400 && CONTEXT_OVERFLOW.test(body);
  throw new ProviderError(
    `${provider} HTTP ${res.status}: ${body.slice(0, 500)}`,
    provider,
    res.status,
    isRetryableStatus(res.status),
    overflow ? "context_overflow" : undefined,
  );
}

// Parses a text/event-stream body into `data:` payloads (joined per event).
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buf = "";
  let data: string[] = [];
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line === "") {
        if (data.length) yield data.join("\n");
        data = [];
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(/^ /, ""));
      }
    }
  }
  if (data.length) yield data.join("\n");
}

// Parses newline-delimited JSON (Ollama streaming format).
export async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf);
}

// Parses tool-call argument JSON accumulated from a stream. Returns null on invalid JSON
// so the agent loop can report the error back to the model instead of running the tool.
export function parseToolArgs(raw: string): Record<string, unknown> | null {
  if (raw.trim() === "") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
