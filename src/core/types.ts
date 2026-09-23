// Provider-neutral data model. Every provider adapter converts to and from these shapes,
// so the agent loop, telemetry and benchmarks never depend on a vendor wire format.

export type Role = "user" | "assistant";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ImageBlock {
  type: "image";
  mediaType: string; // e.g. image/png
  data: string; // base64, no data: prefix
}

export interface ToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  input: Record<string, unknown>;
  // Opaque provider data that must round-trip (e.g. Gemini thought signatures).
  signature?: string;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface ThinkingBlock {
  type: "thinking";
  text: string;
  // Opaque provider data that must be echoed back unchanged (e.g. Anthropic signatures).
  signature?: string;
}

export type ContentBlock = TextBlock | ImageBlock | ToolCallBlock | ToolResultBlock | ThinkingBlock;

export interface Message {
  role: Role;
  content: ContentBlock[];
}

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "error" | "other";

// Normalised across providers: inputTokens INCLUDES cacheRead/cacheWrite tokens,
// outputTokens INCLUDES reasoningTokens.
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
});

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
});

export interface ChatRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  maxTokens: number;
  temperature?: number;
  // Sampling beyond temperature (applied where the runtime supports it).
  topP?: number;
  topK?: number;
  minP?: number;
  // Variables for the model's chat template (e.g. {enable_thinking: true}).
  templateKwargs?: Record<string, unknown>;
  reasoning?: "off" | "low" | "medium" | "high" | "max";
  // Context window the harness budgets for. Local runtimes that size the KV cache per
  // request (Ollama num_ctx) receive it explicitly so prompts are never silently truncated.
  contextWindow?: number;
  // Constrain the reply to JSON matching this schema (grammar-constrained decoding on
  // runtimes that support it). Used for structured outputs, never for tool calling.
  responseSchema?: JsonSchema;
  signal?: AbortSignal;
}

// Server-side timing reported by local runtimes (llama.cpp `timings`, Ollama durations).
export interface RuntimeTimings {
  promptTokens?: number;
  promptMs?: number;
  prefillTokensPerSec?: number;
  decodeTokens?: number;
  decodeMs?: number;
  decodeTokensPerSec?: number;
  cachedTokens?: number; // prompt tokens served from the KV cache
  loadMs?: number; // model load time before this request
}

// Streamed events emitted by every provider. `done` is always last on success.
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; partialJson: string }
  | { type: "done"; message: Message; stopReason: StopReason; usage: Usage; timings?: RuntimeTimings };

export interface ChatResult {
  message: Message;
  stopReason: StopReason;
  usage: Usage;
}

export type Modality = "text" | "image" | "audio" | "video" | "pdf" | "3d" | "embedding";

export interface ModelInfo {
  id: string; // provider-local id, e.g. claude-opus-5
  provider: string; // provider key, e.g. anthropic
  name: string;
  family?: string;
  contextWindow?: number;
  maxOutput?: number;
  inputModalities: Modality[];
  outputModalities: Modality[];
  toolCall: boolean;
  reasoning: boolean;
  openWeights?: boolean;
  // USD per million tokens
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  kinds: ModelKind[];
  releaseDate?: string;
  source: "models.dev" | "live" | "openrouter" | "huggingface";
  // Facts about a locally served model, used for memory-aware context sizing.
  local?: LocalModelFacts;
}

export interface LocalModelFacts {
  runtime: string; // provider key of the serving runtime
  sizeBytes?: number; // weights on disk
  quantization?: string;
  parameterSize?: string;
  trainedContext?: number;
  fixedContext?: number; // runtimes that fix n_ctx at load time (llama.cpp, LM Studio)
  kv?: { layers: number; kvHeads: number; headDim: number };
}

// Functional category of a model. A model can have several.
export type ModelKind = "chat" | "embedding" | "image-gen" | "3d-gen" | "tts" | "stt" | "rerank" | "moderation";

export const textOf = (m: Message): string =>
  m.content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

export const toolCallsOf = (m: Message): ToolCallBlock[] =>
  m.content.filter((b): b is ToolCallBlock => b.type === "tool_call");
