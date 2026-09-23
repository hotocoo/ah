import type { AhConfig, ProviderConfig } from "../config.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GeminiProvider } from "./gemini.ts";
import { MockProvider } from "./mock.ts";
import { OllamaProvider } from "./ollama.ts";
import { OpenAICompatProvider } from "./openai-compat.ts";
import type { Provider } from "./provider.ts";

// Built-in provider presets. Each is enabled when its API key env var is set
// (or, for local servers, always registered and probed lazily).
type Preset = ProviderConfig & {
  local?: boolean;
  imageGen?: boolean;
  maxTokensParam?: "max_tokens" | "max_completion_tokens";
  reasoningParam?: "openai" | "openrouter" | "none";
  streamUsage?: boolean;
};

export const PRESETS: Record<string, Preset> = {
  anthropic: { kind: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" },
  openai: { kind: "openai-compatible", baseURL: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY", imageGen: true, maxTokensParam: "max_completion_tokens", reasoningParam: "openai", streamUsage: true },
  google: { kind: "gemini", apiKeyEnv: "GEMINI_API_KEY" },
  openrouter: { kind: "openai-compatible", baseURL: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", reasoningParam: "openrouter", streamUsage: true },
  groq: { kind: "openai-compatible", baseURL: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", streamUsage: true },
  together: { kind: "openai-compatible", baseURL: "https://api.together.xyz/v1", apiKeyEnv: "TOGETHER_API_KEY", imageGen: true, streamUsage: true },
  deepseek: { kind: "openai-compatible", baseURL: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY", streamUsage: true },
  xai: { kind: "openai-compatible", baseURL: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY", imageGen: true, streamUsage: true },
  mistral: { kind: "openai-compatible", baseURL: "https://api.mistral.ai/v1", apiKeyEnv: "MISTRAL_API_KEY" },
  fireworks: { kind: "openai-compatible", baseURL: "https://api.fireworks.ai/inference/v1", apiKeyEnv: "FIREWORKS_API_KEY", streamUsage: true },
  cerebras: { kind: "openai-compatible", baseURL: "https://api.cerebras.ai/v1", apiKeyEnv: "CEREBRAS_API_KEY", streamUsage: true },
  perplexity: { kind: "openai-compatible", baseURL: "https://api.perplexity.ai", apiKeyEnv: "PERPLEXITY_API_KEY" },
  nvidia: { kind: "openai-compatible", baseURL: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_API_KEY", streamUsage: true },
  huggingface: { kind: "openai-compatible", baseURL: "https://router.huggingface.co/v1", apiKeyEnv: "HF_TOKEN", streamUsage: true },
  moonshot: { kind: "openai-compatible", baseURL: "https://api.moonshot.ai/v1", apiKeyEnv: "MOONSHOT_API_KEY", streamUsage: true },
  zai: { kind: "openai-compatible", baseURL: "https://api.z.ai/api/paas/v4", apiKeyEnv: "ZAI_API_KEY", streamUsage: true },
  ollama: { kind: "ollama", baseURL: process.env.OLLAMA_HOST ?? "http://localhost:11434", local: true },
  lmstudio: { kind: "openai-compatible", baseURL: "http://localhost:1234/v1", local: true },
  vllm: { kind: "openai-compatible", baseURL: process.env.VLLM_BASE_URL ?? "http://localhost:8000/v1", local: true, streamUsage: true },
  llamacpp: { kind: "openai-compatible", baseURL: "http://localhost:8080/v1", local: true },
  mock: { kind: "mock", local: true },
};

const resolveKey = (c: ProviderConfig): string | undefined =>
  c.apiKey ?? (c.apiKeyEnv ? process.env[c.apiKeyEnv] : undefined);

export function createProvider(key: string, c: Preset): Provider | null {
  const apiKey = resolveKey(c);
  switch (c.kind) {
    case "anthropic":
      return new AnthropicProvider(key, { apiKey, baseURL: c.baseURL });
    case "openai-compatible":
      return new OpenAICompatProvider(key, {
        baseURL: c.baseURL!,
        apiKey,
        headers: c.headers,
        imageGen: c.imageGen,
        maxTokensParam: c.maxTokensParam,
        reasoningParam: c.reasoningParam,
        streamUsage: c.streamUsage,
      });
    case "gemini":
      return new GeminiProvider(key, apiKey ?? "", c.baseURL);
    case "ollama":
      return new OllamaProvider(key, c.baseURL);
    case "mock":
      return new MockProvider();
    default:
      return null; // media-only backends live in src/media
  }
}

export class ProviderRegistry {
  private providers = new Map<string, Provider>();

  static fromConfig(cfg: AhConfig): ProviderRegistry {
    const reg = new ProviderRegistry();
    const all = { ...PRESETS, ...cfg.providers };
    for (const [key, c] of Object.entries(all)) {
      if (c.enabled === false) continue;
      const preset = PRESETS[key];
      const isLocal = preset?.local ?? false;
      const configured = key in cfg.providers;
      if (!isLocal && !configured && !resolveKey(c)) continue;
      const p = createProvider(key, { ...preset, ...c });
      if (p) reg.register(p);
    }
    return reg;
  }

  register(p: Provider): void {
    this.providers.set(p.key, p);
  }

  get(key: string): Provider {
    const p = this.providers.get(key);
    if (!p) {
      const preset = PRESETS[key];
      const hint = preset?.apiKeyEnv ? ` (set ${preset.apiKeyEnv})` : "";
      throw new Error(`provider "${key}" is not configured${hint}`);
    }
    return p;
  }

  has(key: string): boolean {
    return this.providers.has(key);
  }

  list(): Provider[] {
    return [...this.providers.values()];
  }
}
