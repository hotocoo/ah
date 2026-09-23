import {
  emptyUsage,
  type ChatRequest,
  type ContentBlock,
  type Message,
  type ModelInfo,
  type StreamEvent,
  type Usage,
} from "../core/types.ts";
import { encodePng } from "../media/png.ts";
import { ProviderError, type GeneratedImage, type ImageGenRequest, type Provider, type ProviderCapabilities } from "./provider.ts";

// One scripted assistant turn. The mock replays turn N when the conversation contains
// N assistant messages, so the script is stateless and works across agent-loop restarts.
export interface MockTurn {
  text?: string;
  toolCalls?: { name: string; input: Record<string, unknown> }[];
  stopReason?: "end_turn" | "max_tokens" | "refusal";
}

export interface MockOptions {
  script?: MockTurn[];
  // Artificial delay per streamed chunk, to exercise TTFT and throughput telemetry.
  chunkDelayMs?: number;
  failTimes?: number; // fail the first N calls with a retryable error
}

const estimateTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

const requestChars = (req: ChatRequest): number =>
  req.system.length +
  JSON.stringify(req.messages).length +
  JSON.stringify(req.tools).length;

// Deterministic, keyless provider. Drives unit tests and the offline benchmark suite.
export class MockProvider implements Provider {
  readonly key = "mock";
  readonly kind = "mock";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    streaming: true,
    tools: true,
    vision: true,
    embeddings: true,
    imageGen: true,
    modelListing: true,
  };
  private scripts = new Map<string, MockTurn[]>();
  private calls = 0;

  constructor(private opts: MockOptions = {}) {
    if (opts.script) this.scripts.set("scripted", opts.script);
  }

  setScript(script: MockTurn[], model = "scripted"): void {
    this.scripts.set(model, script);
  }

  async listModels(): Promise<ModelInfo[]> {
    const base = {
      provider: this.key,
      contextWindow: 200_000,
      maxOutput: 32_000,
      toolCall: true,
      reasoning: false,
      cost: { input: 0, output: 0 },
      source: "live" as const,
    };
    return [
      { ...base, id: "scripted", name: "Mock scripted", inputModalities: ["text"], outputModalities: ["text"], kinds: ["chat"] },
      { ...base, id: "echo", name: "Mock echo", inputModalities: ["text", "image"], outputModalities: ["text"], kinds: ["chat"] },
      { ...base, id: "image", name: "Mock image", inputModalities: ["text"], outputModalities: ["image"], kinds: ["image-gen"], toolCall: false },
      { ...base, id: "embed", name: "Mock embedding", inputModalities: ["text"], outputModalities: ["embedding"], kinds: ["embedding"], toolCall: false },
    ];
  }

  private turnFor(req: ChatRequest): MockTurn {
    const script = this.scripts.get(req.model);
    const assistantTurns = req.messages.filter((m) => m.role === "assistant").length;
    if (script) return script[assistantTurns] ?? { text: "Done." };
    const last = req.messages.at(-1);
    const lastText = last?.content.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? b.content : "")).join("") ?? "";
    return { text: `echo: ${lastText}` };
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    this.calls++;
    if (this.opts.failTimes && this.calls <= this.opts.failTimes) {
      throw new ProviderError("mock transient failure", this.key, 503, true);
    }
    const turn = this.turnFor(req);
    const delay = this.opts.chunkDelayMs ?? 0;
    const content: ContentBlock[] = [];
    if (turn.text) {
      for (const piece of turn.text.match(/.{1,16}/gs) ?? []) {
        if (req.signal?.aborted) throw new Error("aborted");
        if (delay) await Bun.sleep(delay);
        yield { type: "text_delta", text: piece };
      }
      content.push({ type: "text", text: turn.text });
    }
    (turn.toolCalls ?? []).forEach((tc, i) => {
      content.push({ type: "tool_call", id: `mock_${this.calls}_${i}`, name: tc.name, input: tc.input });
    });
    for (const b of content) {
      if (b.type !== "tool_call") continue;
      yield { type: "tool_call_start", id: b.id, name: b.name };
      yield { type: "tool_call_delta", id: b.id, partialJson: JSON.stringify(b.input) };
    }
    const message: Message = { role: "assistant", content };
    const usage: Usage = {
      ...emptyUsage(),
      inputTokens: Math.ceil(requestChars(req) / 4),
      outputTokens: estimateTokens(JSON.stringify(content)),
    };
    const stopReason = turn.stopReason ?? (turn.toolCalls?.length ? "tool_use" : "end_turn");
    yield { type: "done", message, stopReason, usage };
  }

  async generateImage(req: ImageGenRequest): Promise<GeneratedImage[]> {
    const [w, h] = (req.size ?? "64x64").split("x").map(Number);
    const seed = [...req.prompt].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const width = Math.min(w || 64, 512);
    const height = Math.min(h || 64, 512);
    const png = encodePng(width, height, (x, y) => [
      (x * 255) / width,
      (y * 255) / height,
      (seed >> 8) & 255,
      255,
    ]);
    return Array.from({ length: req.n ?? 1 }, () => ({ mediaType: "image/png", data: png.toString("base64") }));
  }

  async embed(req: { input: string[] }): Promise<number[][]> {
    return req.input.map((s) => {
      const v = new Array(16).fill(0);
      for (let i = 0; i < s.length; i++) v[i % 16] += s.charCodeAt(i) / 1000;
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}
