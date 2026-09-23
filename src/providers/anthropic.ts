import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatRequest,
  ContentBlock,
  Message,
  ModelInfo,
  Modality,
  StopReason,
  StreamEvent,
  Usage,
} from "../core/types.ts";
import { ProviderError, type Provider, type ProviderCapabilities } from "./provider.ts";

type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContent = Anthropic.Beta.Messages.BetaContentBlockParam;
type BetaTool = Anthropic.Beta.Messages.BetaTool;

// Models that still need the legacy fixed thinking budget instead of adaptive thinking.
const LEGACY_THINKING = /claude-(3|haiku-4-5|sonnet-4-5|opus-4-5|opus-4-1|opus-4-0|sonnet-4-0)/;
// Models where `fallbacks: "default"` is supported for safety-classifier refusals.
const FALLBACK_MODELS = /claude-(opus-5|fable-5|mythos-5)/;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface AnthropicOptions {
  apiKey?: string;
  baseURL?: string;
  // Opt out of server-side refusal fallbacks (on by default for models that support them).
  serverFallbacks?: boolean;
}

function toAnthropicContent(b: ContentBlock): BetaContent | null {
  switch (b.type) {
    case "text":
      return { type: "text", text: b.text };
    case "image":
      return {
        type: "image",
        source: { type: "base64", media_type: b.mediaType as "image/png", data: b.data },
      };
    case "tool_call":
      return { type: "tool_use", id: b.id, name: b.name, input: b.input };
    case "tool_result":
      return { type: "tool_result", tool_use_id: b.toolCallId, content: b.content, is_error: b.isError };
    case "thinking":
      // Thinking blocks are only valid when echoed with their signature.
      return b.signature ? { type: "thinking", thinking: b.text, signature: b.signature } : null;
  }
}

export function toAnthropicMessages(messages: Message[]): BetaMessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map(toAnthropicContent).filter((c): c is BetaContent => c !== null),
  }));
}

function fromAnthropicContent(blocks: Anthropic.Beta.Messages.BetaContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    if (b.type === "text") out.push({ type: "text", text: b.text });
    else if (b.type === "tool_use")
      out.push({ type: "tool_call", id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
    else if (b.type === "thinking") out.push({ type: "thinking", text: b.thinking, signature: b.signature });
  }
  return out;
}

const mapStop = (s: string | null | undefined): StopReason => {
  switch (s) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
};

export class AnthropicProvider implements Provider {
  readonly kind = "anthropic";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    streaming: true,
    tools: true,
    vision: true,
    embeddings: false,
    imageGen: false,
    modelListing: true,
  };
  private client: Anthropic;

  constructor(
    readonly key = "anthropic",
    private opts: AnthropicOptions = {},
  ) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  }

  buildParams(req: ChatRequest): { params: BetaParams; betas: string[] } {
    const betas: string[] = [];
    const tools: BetaTool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as BetaTool["input_schema"],
      // Streamed request with client tools: stream large inputs (file bodies) as generated.
      // The agent loop validates every parsed input against the schema before running it.
      eager_input_streaming: true,
    }));
    const params: BetaParams = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      tools,
      stream: true,
    };
    const effort = req.reasoning && req.reasoning !== "off" ? req.reasoning : undefined;
    if (LEGACY_THINKING.test(req.model)) {
      if (effort) {
        const budget = { low: 2048, medium: 8192, high: 16384, max: 32000 }[effort];
        // budget_tokens must be >= 1024 and < max_tokens.
        if (req.maxTokens > 2048)
          params.thinking = { type: "enabled", budget_tokens: Math.max(1024, Math.min(budget, req.maxTokens - 1024)) };
      }
      if (req.temperature !== undefined && !effort) params.temperature = req.temperature;
    } else {
      // Current models: adaptive thinking; depth controlled by effort.
      params.thinking = { type: "adaptive" };
      if (effort) params.output_config = { effort };
    }
    if (this.opts.serverFallbacks !== false && FALLBACK_MODELS.test(req.model)) {
      params.fallbacks = "default";
      betas.push(FALLBACK_BETA);
    }
    return { params, betas };
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const { params, betas } = this.buildParams(req);
    const idsByIndex = new Map<number, string>();
    try {
      const stream = this.client.beta.messages.stream(
        { ...params, ...(betas.length ? { betas } : {}) },
        { signal: req.signal },
      );
      for await (const ev of stream) {
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
          idsByIndex.set(ev.index, ev.content_block.id);
          yield { type: "tool_call_start", id: ev.content_block.id, name: ev.content_block.name };
        } else if (ev.type === "content_block_delta") {
          const d = ev.delta;
          if (d.type === "text_delta") yield { type: "text_delta", text: d.text };
          else if (d.type === "thinking_delta") yield { type: "thinking_delta", text: d.thinking };
          else if (d.type === "input_json_delta")
            yield { type: "tool_call_delta", id: idsByIndex.get(ev.index) ?? "", partialJson: d.partial_json };
        }
      }
      const final = await stream.finalMessage();
      const u = final.usage;
      const usage: Usage = {
        // Normalised: inputTokens includes cached tokens (Anthropic reports them separately).
        inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        reasoningTokens: 0,
      };
      yield {
        type: "done",
        message: { role: "assistant", content: fromAnthropicContent(final.content) },
        stopReason: mapStop(final.stop_reason),
        usage,
      };
    } catch (err) {
      if (req.signal?.aborted) throw err;
      if (err instanceof Anthropic.APIError) {
        const status = typeof err.status === "number" ? err.status : undefined;
        const retryable = err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError;
        throw new ProviderError(`anthropic: ${err.message}`, this.key, status, retryable);
      }
      // The SDK raises a bare AnthropicError when eager-streamed tool JSON cannot be parsed.
      if (err instanceof Anthropic.AnthropicError && /parse tool parameter JSON/.test(err.message))
        throw new ProviderError(`anthropic: ${err.message}`, this.key, undefined, true, "invalid_tool_json");
      throw err;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    for await (const m of this.client.models.list()) {
      const caps = m.capabilities;
      const input: Modality[] = ["text"];
      if (caps?.image_input?.supported) input.push("image");
      if (caps?.pdf_input?.supported) input.push("pdf");
      out.push({
        id: m.id,
        provider: this.key,
        name: m.display_name,
        contextWindow: m.max_input_tokens ?? undefined,
        maxOutput: m.max_tokens ?? undefined,
        inputModalities: input,
        outputModalities: ["text"],
        toolCall: true,
        reasoning: Boolean(caps?.thinking?.supported),
        kinds: ["chat"],
        releaseDate: m.created_at?.slice(0, 10),
        source: "live",
      });
    }
    return out;
  }
}
