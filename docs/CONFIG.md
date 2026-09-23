# Configuration

Optional. Precedence: built-in defaults < `~/.ah/config.json` < `<workspace>/.ah/config.json`. Environment variables override where noted.

```jsonc
{
  "defaultModel": "llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF",        // AH_MODEL; unset = auto-select a local model
  "imageModel": "comfyui/sd_xl_base_1.0.safetensors", // AH_IMAGE_MODEL; unset = first local backend
  "model3d": "llamacpp/my-model",            // AH_3D_MODEL; unset = the session's model
  "runtimes": { "endpoints": ["http://gpu-box:11434"], "scan": true },  // AH_SCAN=0 disables port scan
  "contextWindow": 65536,                    // AH_CONTEXT; capped by trained max and memory
  "maxTokens": 32000,
  "maxTurns": 60,
  "reasoning": "high",                        // off | low | medium | high | max (mapped per server)
  "permissionMode": "ask",                   // ask | auto | read-only
  "toolProtocol": "auto",                    // auto | native | text (AH_TOOL_PROTOCOL)
  "compactToolsRatio": 6,                    // compact tools when window < ratio x (prompt + tool defs)
  "memory": { "fraction": 0.75, "minContext": 16384, "kvBytesPerElement": 2 },
  "contextBudgetRatio": 0.8,                 // compact history above this share of the window
  "bashTimeoutMs": 120000,
  "image": { "width": 1024, "height": 1024, "steps": 20, "cfg": 7, "sampler": "euler", "scheduler": "normal", "negative": "blurry, low quality" },
  "telemetry": { "enabled": true, "otlpEndpoint": "http://localhost:4318" },  // AH_TELEMETRY=0; OTEL_EXPORTER_OTLP_ENDPOINT
  "hardwareSampling": { "enabled": true, "intervalMs": 1000 },               // AH_HW=0
  "providers": {
    "mybox": { "kind": "openai-compatible", "baseURL": "http://10.0.0.5:8000/v1", "apiKeyEnv": "MYBOX_KEY" },
    "anthropic": { "kind": "anthropic", "apiKeyEnv": "ANTHROPIC_API_KEY", "serverFallbacks": true },
    "ollama-12434": { "kind": "ollama", "enabled": false }
  },
  "dataDir": "~/.ah"                          // AH_HOME
}
```

Provider `kind`: `ollama`, `llamacpp`, `lmstudio`, `openai-compatible`, `anthropic`, `gemini`, `mock`. Cloud providers with an API key in the environment are added automatically from models.dev; config entries override or disable them.

Repository instructions: `AGENTS.md`, `CLAUDE.md`, `.ah/instructions.md`, `.cursorrules` and `.github/copilot-instructions.md` in the workspace root are included in the system prompt.
