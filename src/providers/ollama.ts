import type { ChatRequest, ContentBlock, Message, ModelInfo, Modality, StreamEvent, Usage } from "../core/types.ts";
import { ensureOk, ndjson, type EmbedRequest, type Provider, type ProviderCapabilities } from "./provider.ts";

// Native Ollama adapter (/api/chat). Local, keyless; also works for remote Ollama hosts.
interface OllamaMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  thinking?: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
}

export function toOllamaMessages(system: string, messages: Message[]): OllamaMsg[] {
  const out: OllamaMsg[] = system ? [{ role: "system", content: system }] : [];
  const toolNames = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "assistant") {
      const calls = m.content.filter((b) => b.type === "tool_call") as Extract<ContentBlock, { type: "tool_call" }>[];
      calls.forEach((c) => toolNames.set(c.id, c.name));
      out.push({
        role: "assistant",
        content: m.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
        ...(calls.length ? { tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.input } })) } : {}),
      });
      continue;
    }
    const texts: string[] = [];
    const images: string[] = [];
    for (const b of m.content) {
      if (b.type === "tool_result")
        out.push({ role: "tool", content: b.isError ? `ERROR: ${b.content}` : b.content, tool_name: toolNames.get(b.toolCallId) });
      else if (b.type === "text") texts.push(b.text);
      else if (b.type === "image") images.push(b.data);
    }
    if (texts.length || images.length)
      out.push({ role: "user", content: texts.join("\n"), ...(images.length ? { images } : {}) });
  }
  return out;
}

export class OllamaProvider implements Provider {
  readonly kind = "ollama";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    streaming: true,
    tools: true,
    vision: true,
    embeddings: true,
    imageGen: false,
    modelListing: true,
  };

  constructor(
    readonly key = "ollama",
    private baseURL = "http://localhost:11434",
  ) {}

  private url(p: string) {
    return `${this.baseURL.replace(/\/$/, "")}${p}`;
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOllamaMessages(req.system, req.messages),
      stream: true,
      options: { num_predict: req.maxTokens, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) },
    };
    if (req.tools.length)
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    // Only thinking-capable models accept `think`; others return HTTP 400.
    if (req.reasoning && (await this.capabilitiesOf(req.model, req.signal)).includes("thinking"))
      body.think = req.reasoning !== "off";
    const res = await ensureOk(
      await fetch(this.url("/api/chat"), { method: "POST", body: JSON.stringify(body), signal: req.signal }),
      this.key,
    );
    let text = "";
    const content: ContentBlock[] = [];
    const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
    let doneReason = "stop";
    let n = 0;
    for await (const raw of ndjson(res.body!)) {
      const chunk = raw as { message?: OllamaMsg; done?: boolean; done_reason?: string; prompt_eval_count?: number; eval_count?: number; error?: string };
      if (chunk.error) throw new Error(`ollama: ${chunk.error}`);
      const msg = chunk.message;
      if (msg?.thinking) yield { type: "thinking_delta", text: msg.thinking };
      if (msg?.content) {
        text += msg.content;
        yield { type: "text_delta", text: msg.content };
      }
      for (const tc of msg?.tool_calls ?? []) {
        const id = `ollama_${Date.now()}_${n++}`;
        yield { type: "tool_call_start", id, name: tc.function.name };
        yield { type: "tool_call_delta", id, partialJson: JSON.stringify(tc.function.arguments ?? {}) };
        content.push({ type: "tool_call", id, name: tc.function.name, input: tc.function.arguments ?? {} });
      }
      if (chunk.done) {
        usage.inputTokens = chunk.prompt_eval_count ?? 0;
        usage.outputTokens = chunk.eval_count ?? 0;
        doneReason = chunk.done_reason ?? "stop";
      }
    }
    if (text) content.unshift({ type: "text", text });
    const hasCalls = content.some((b) => b.type === "tool_call");
    yield {
      type: "done",
      message: { role: "assistant", content },
      stopReason: hasCalls ? "tool_use" : doneReason === "length" ? "max_tokens" : "end_turn",
      usage,
    };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await ensureOk(await fetch(this.url("/api/tags"), { signal }), this.key);
    const json = (await res.json()) as { models?: { name: string; details?: { family?: string } }[] };
    return Promise.all(
      (json.models ?? []).map(async (m) => {
        const caps = await this.capabilitiesOf(m.name, signal);
        const input: Modality[] = caps.includes("vision") ? ["text", "image"] : ["text"];
        const embedding = caps.includes("embedding");
        return {
          id: m.name,
          provider: this.key,
          name: m.name,
          family: m.details?.family,
          contextWindow: caps.context,
          inputModalities: input,
          outputModalities: embedding ? ["embedding"] : ["text"],
          toolCall: caps.includes("tools"),
          reasoning: caps.includes("thinking"),
          openWeights: true,
          cost: { input: 0, output: 0 },
          kinds: embedding ? ["embedding"] : ["chat"],
          source: "live" as const,
        } satisfies ModelInfo;
      }),
    );
  }

  private capsCache = new Map<string, Promise<string[] & { context?: number }>>();

  private capabilitiesOf(model: string, signal?: AbortSignal): Promise<string[] & { context?: number }> {
    let p = this.capsCache.get(model);
    if (!p) {
      p = this.showCapabilities(model, signal);
      this.capsCache.set(model, p);
    }
    return p;
  }

  private async showCapabilities(model: string, signal?: AbortSignal): Promise<string[] & { context?: number }> {
    try {
      const res = await fetch(this.url("/api/show"), { method: "POST", body: JSON.stringify({ model }), signal });
      if (!res.ok) return [];
      const j = (await res.json()) as { capabilities?: string[]; model_info?: Record<string, unknown> };
      const caps: string[] & { context?: number } = [...(j.capabilities ?? [])];
      const ctxKey = Object.keys(j.model_info ?? {}).find((k) => k.endsWith(".context_length"));
      if (ctxKey) caps.context = Number(j.model_info![ctxKey]);
      return caps;
    } catch {
      return [];
    }
  }

  async embed(req: EmbedRequest): Promise<number[][]> {
    const res = await ensureOk(
      await fetch(this.url("/api/embed"), { method: "POST", body: JSON.stringify({ model: req.model, input: req.input }), signal: req.signal }),
      this.key,
    );
    return ((await res.json()) as { embeddings: number[][] }).embeddings;
  }
}
