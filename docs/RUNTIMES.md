# Runtimes, providers and models

## Discovery

`ah doctor` shows what `ah` found. Nothing is preconfigured; candidates come from:

1. `runtimes.endpoints` in config (e.g. a remote Ollama: `"http://gpu-box:11434"`),
2. environment variables named `OLLAMA_HOST` or `*_BASE_URL` / `*_HOST` / `*_ENDPOINT` that point at localhost,
3. every TCP port this user has listening locally (`lsof`, or `ss` on Linux). Turn scanning off with `AH_SCAN=0` or `runtimes.scan: false`.

Each candidate is fingerprinted by API signature:

| runtime | signature | what `ah` reads |
|---|---|---|
| Ollama (and Ollama-compatible shims) | `GET /api/version` | `/api/tags`, `/api/show` (capabilities, GGUF context length, KV geometry), `/api/ps` (resident models and their context) |
| llama.cpp `llama-server` | `GET /props` with `default_generation_settings` | `n_ctx`, slots, modalities, chat template tool support, `timings` per response |
| ComfyUI | `GET /system_stats` | checkpoints from `/models/checkpoints` |
| stable-diffusion.cpp / A1111 / Forge | `GET /sdapi/v1/sd-models` | models |
| LM Studio | `GET /api/v0/models` with per-model `state` | loaded/max context, type |
| anything OpenAI-compatible (mlx_lm.server, vLLM, SGLang, vllm-mlx, LocalAI, ...) | `GET /v1/models` | model ids |

Provider keys are the runtime kind (`ollama`, `llamacpp`, ...), suffixed with the port when there are several (`ollama-12434`). Models are referenced as `provider/model`, e.g. `llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF`.

## Choosing a model

`--model` > `defaultModel` in config / `AH_MODEL` > auto-selection: a model already resident in llama.cpp/LM Studio (no load time), else the largest tool-capable local chat model.

## Context window

See D19 in `DECISIONS.md`. `ah run` prints the chosen window and why, e.g. `context window 262144 (fixed by the runtime at load time)` or `context window 32768 (limited by available memory for the KV cache)`. Override with `contextWindow` in config or `AH_CONTEXT`.

## Tool calling on local models

- `toolProtocol: "auto"` (default): native tool calls when the runtime reports tool support; **text protocol** when it reports none (tools described in the prompt, calls parsed from text).
- Either way, tool calls a model writes as text (`<tool_call>`, Qwen3-Coder XML, `<invoke>`, Mistral `[TOOL_CALLS]`, Llama `<|python_tag|>`, fenced or bare JSON, ...) are recovered and validated.
- Small windows get the compact tool profile (no `multi_edit`, `repo_map`, `todo_write`, `web_fetch`).

## Cloud providers (optional)

Any provider in the models.dev catalog becomes available when one of its API-key environment variables is set; the base URL and adapter come from the catalog (`api`, `npm`). Anthropic uses the official SDK (capability-driven thinking/effort, prompt caching, refusal fallbacks); Gemini uses its native API; everything else uses the OpenAI-compatible adapter with learned wire-format fixes. Explicit entries go in config:

```json
{ "providers": { "mybox": { "kind": "openai-compatible", "baseURL": "http://10.0.0.5:8000/v1", "apiKeyEnv": "MYBOX_KEY" } } }
```

## Model catalog

`ah models [query] [--kind chat|image-gen|3d-gen|embedding|tts] [--local] [--tools] [--min-context N] [--sort cost|context|release] [--refresh] [--json]`. Sources: live runtime listings (always fresh), models.dev and OpenRouter (cached 24 h; stale cache used offline).
