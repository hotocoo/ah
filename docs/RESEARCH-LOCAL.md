# Research: building a coding harness for local LLMs

`ah` is local-first: the primary targets are models served on the user's own machine. This document records what was learned (September 2026) and the design consequences. Facts marked **verified** were checked against the runtimes installed on the development machine (Apple M4 Max, 64 GB unified memory, 40-core GPU; Ollama 0.34.1, llama.cpp `llama-server` build 10621, `mlx-lm` 0.31.3, `comfy` CLI).

## 1. Local runtimes and what they expose

| Runtime | Native API used for discovery | Capabilities source | Context control | Timing data |
|---|---|---|---|---|
| Ollama | `GET /api/version`, `/api/tags`, `POST /api/show`, `/api/ps` | `/api/show.capabilities` (`completion`, `tools`, `thinking`, `vision`, `embedding`, `image`) **verified** | `options.num_ctx` per request; else server default (VRAM-based: 4k/32k/256k) | `prompt_eval_count/duration`, `eval_count/duration`, `load_duration`, `total_duration` (ns) |
| llama.cpp `llama-server` | `GET /health`, `/props`, `/v1/models`, `/slots`, `/metrics` (if `--metrics`) | `/props.chat_template_caps`, `modalities`, `chat_template` | fixed at launch (`n_ctx` in `/props.default_generation_settings`) | per-response `timings` (`cache_n`, `prompt_n`, `prompt_per_second`, `predicted_n`, `predicted_per_second`) |
| MLX (`mlx_lm.server`) | `GET /v1/models` | none (tool parser inferred from chat template; silently fails for unknown formats) | model-defined | none beyond `usage` |
| LM Studio | `GET /api/v1/models` (loaded instances, max context, quantization, size), `/api/v0/models` (legacy) | `type`, `capabilities` fields | `POST /api/v1/models/load {context_length}` | native API reports tokens/s and TTFT |
| vLLM / SGLang / vllm-mlx | `GET /v1/models` (`max_model_len`) | server flags (`--tool-call-parser`) | launch flag | `usage` only |
| ComfyUI | `GET /system_stats`, `/object_info`, `/models/{type}` | node catalog from `/object_info` | n/a | `/history/{id}` status |
| stable-diffusion.cpp `sd-server` / A1111 | `GET /v1/models`, `/sdapi/v1/sd-models` | endpoint presence | n/a | n/a |

Consequences:
- **No hardcoded ports or presets.** `ah` discovers runtimes by (a) reading user config, (b) scanning the machine's listening TCP ports (`lsof -nP -iTCP -sTCP:LISTEN`) and fingerprinting each port against the API signatures above, (c) noting runtime binaries on `PATH` so it can offer to start them. A port answers to the first fingerprint that matches.
- **Capabilities come from the runtime**, not from model-name matching.

## 2. Context window is the first failure mode

- Ollama's default context is far below what an agent needs; prompts longer than `num_ctx` are **silently truncated from the front** (ollama#14259). OpenHands measured that a 4k context cannot hold its system prompt; harness authors recommend 32k-64k minimum for coding.
- `ah` therefore always sends an explicit `num_ctx` to Ollama, computed from: the model's trained maximum (`<arch>.context_length` from `/api/show`), the user's requested context, and a memory budget derived from live free memory and the model's KV-cache size (computed from GGUF metadata: `block_count`, `attention.head_count_kv`, `embedding_length / head_count`).
- Truncation detection: after each response `ah` compares the runtime's reported prompt token count with its own estimate; a large shortfall is reported as a `context_truncated` telemetry event and triggers compaction.
- llama.cpp and LM Studio contexts are fixed at load time; `ah` reads the live value (`/props` `n_ctx`, loaded-instance `context_length`) and uses it as the window.

## 3. Tool calling with local models

Findings:
- Many local models/servers return tool calls **as text in `content`** instead of `tool_calls` (mlx-lm with unknown templates, llama-server without `--jinja`, fine-tunes with non-standard formats). Hermes Agent, hipfire and vLLM all ended up adding content parsers.
- llama-server has returned `arguments` as a JSON object instead of a string (llama.cpp#20198); parsers must accept both.
- Small models (1-4B) miss parameters when descriptions are long and struggle to choose among many tools. Keeping the tool surface small helps (Pi ships 4 tools).
- Grammar constraints (GBNF, `response_format: json_schema`) guarantee well-formed output but can suppress the decision to call a tool ("constraint tax", arXiv 2606.25605). Parsing and constraining must be separate switches.
- Aider's text edit formats (search/replace blocks) work when structured tool calls do not.

Design:
1. Native `tool_calls` first.
2. If absent, a **content parser** registry extracts calls from text: `<tool_call>{json}</tool_call>`, `<function=name>...</function>`, `<function name="...">`, `[TOOL_CALLS][...]`, fenced ```json blocks with `name`/`arguments`, bare JSON objects. Arguments accepted as string or object.
3. For models whose runtime reports no tool capability, `ah` switches to **text-protocol mode**: tool schemas are described in the system prompt with an explicit `<tool_call>` format, and the parser from step 2 reads the result.
4. Tool surface scales with the context window: below a threshold (derived as a share of the window, not a model list), `ah` uses a compact tool set and a compact system prompt.
5. Every call is validated against the tool schema; unknown names are rejected with the list of valid ones.

## 4. Model discovery for local use

- Installed models: from each runtime (`/api/tags`, `/v1/models`, `/api/v1/models`).
- Downloadable models: Hugging Face Hub API. `GET /api/models?library=gguf|mlx&search=...&sort=downloads&expand[]=gguf` returns GGUF metadata (`architecture`, `context_length`, `total` size) **verified**; `GET /api/models/{repo}/tree/main` lists files with byte sizes **verified**. Quantization is read from file names (`Q4_K_M`, `IQ4_XS`) or MLX repo names (`4bit`).
- **Hardware fit** is computed, not tabulated: `fits = weights + kv_cache(ctx) + overhead <= usable_memory`, where usable memory comes from `os.totalmem()`, current free memory and (on Apple Silicon) the GPU allocation reported by `ioreg`.
- Cloud providers are optional and derived from models.dev: each provider entry carries `api` (base URL), `env` (API-key variable names) and `npm` (SDK package), which maps to an `ah` adapter (`@ai-sdk/anthropic` -> anthropic, `@ai-sdk/google` -> gemini, `@ai-sdk/openai*` -> openai-compatible). No provider list lives in the source.

## 5. Local telemetry

- Per turn: prefill tokens/s and decode tokens/s from runtime timings (Ollama durations, llama.cpp `timings`), model load time (Ollama `load_duration`), KV-cache reuse (`timings.cache_n / (cache_n + prompt_n)`), TTFT and end-to-end latency measured by `ah`.
- Hardware sampler (macOS, no sudo): `ioreg -r -d 1 -c IOAccelerator` PerformanceStatistics -> `Device Utilization %`, `Alloc system memory`, `In use system memory` **verified**; process RSS of the runtime; system memory via `vm_stat`. If `macmon` is installed, its JSON output adds GPU/CPU power and temperature. Linux: `nvidia-smi --query-gpu` when present. Sampled during each run, stored per turn.
- Cost for local models is zero tokens-wise; energy (joules) is recorded when a power source is available.

## 6. Local image generation

- **Ollama** shipped experimental image generation (Jan 2026, `x/z-image-turbo`, `x/flux2-klein`, MLX-based) and **temporarily removed it in v0.32.6+**, while `/api/tags` still lists `image` capability (ollama#17893). `ah` must probe with a real request and cache the result rather than trust the capability flag.
- **ComfyUI**: `POST /prompt` with an API-format graph, poll `/history/{id}`, fetch `/view`. Checkpoints are discovered via `/models/checkpoints` (or `/object_info`). `ah` builds a minimal text-to-image graph from core nodes and the discovered checkpoint, or runs user workflow files with a prompt placeholder.
- **stable-diffusion.cpp `sd-server`** and **A1111/Forge**: OpenAI-compatible `/v1/images/generations` and `/sdapi/v1/txt2img`.
- Cloud image APIs remain available through the provider layer when configured.

## 7. Local 3D generation

- No fully local text-to-3D pipeline exists; the practical route is **text -> image (local) -> 3D (local image-to-3D)**.
- Image-to-3D servers usable on Apple Silicon: Hunyuan3D-2 `api_server.py --device mps` (shape only), Hunyuan3D-2.1 MLX fork (textured), TRELLIS.2 community port (~3.5 min on M4 Pro), TripoSG. They expose ad-hoc HTTP APIs, so `ah` treats them as user-configured endpoints with a small adapter contract (POST image -> GLB bytes).
- Keyless default: **procedural modelling** - the local LLM writes a structured scene (primitives, transforms, materials), `ah` compiles it to GLB/glTF/OBJ/STL and renders a preview PNG. Works with any chat model and no extra weights.

## 8. Benchmarking local models

- Throughput benchmark (llama-bench style, but through the serving API so it measures what the harness sees): prefill tokens/s at several prompt lengths, decode tokens/s at several generation lengths, TTFT, load time, with repeated trials and percentiles.
- Agentic benchmark: task suite graded by shell commands in sandboxed copies (see `BENCHMARKING.md`), reporting pass@k, pass^k, Wilson intervals, turns, tool-error rate, tokens, wall time and hardware utilisation.
- Comparisons across models, quantisations and runtimes use the same store.

## Sources

- [llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), [function calling](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md), [llama.cpp#20198](https://github.com/ggml-org/llama.cpp/issues/20198), [llama-server endpoint tour](https://mvysny.github.io/llama-server-endpoints/)
- [Ollama context length](https://docs.ollama.com/context-length), [Ollama PR #10066 (capabilities)](https://github.com/ollama/ollama/pull/10066), [Ollama image generation blog](https://ollama.com/blog/image-generation), [ollama#17893](https://github.com/ollama/ollama/issues/17893)
- [mlx-lm SERVER.md](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md), [mlx-lm#1096](https://github.com/ml-explore/mlx-lm/issues/1096), [vllm-mlx tool calling](https://github.com/waybarrios/vllm-mlx/blob/main/docs/guides/tool-calling.md)
- [LM Studio REST API](https://lmstudio.ai/docs/developer/rest/list), [load](https://lmstudio.ai/docs/developer/rest/load)
- [ComfyUI server routes](https://docs.comfy.org/development/comfyui-server/comms_routes), [websockets example](https://github.com/comfyanonymous/ComfyUI/blob/master/script_examples/websockets_api_example.py)
- [stable-diffusion.cpp server API](https://github.com/leejet/stable-diffusion.cpp/blob/master/examples/server/api.md)
- [Hunyuan3D-2.1 MLX](https://github.com/dgrauet/Hunyuan3D-2.1-mlx), [TRELLIS.2 on Apple Silicon (HN)](https://news.ycombinator.com/item?id=47828896), [Hunyuan3D-2 on Mac](https://3dmate.app/guides/hunyuan3d-2-mac)
- [Hugging Face GGUF docs](https://huggingface.co/docs/hub/gguf), [MLX on the Hub](https://huggingface.co/docs/hub/mlx)
- [macmon](https://github.com/vladkens/macmon), [gpuer (ioreg PerformanceStatistics)](https://github.com/simonw/gpuer)
- [Hermes Agent content tool-call extraction (#29115)](https://github.com/NousResearch/hermes-agent/issues/29115), [hipfire#729](https://github.com/warpfront/hipfire/pull/729), [Constraint Tax (arXiv 2606.25605)](https://arxiv.org/pdf/2606.25605), [GBNF tool calling](https://atomicagent.io/blog/gbnf-grammar-constrained-tool-calling/)
- [Best open-source agent harnesses for local LLMs (MarkTechPost, 2026-09-18)](https://www.marktechpost.com/2026/09/18/best-open-source-agent-harnesses-for-local-llms-in-2026/), [Raschka: using local coding agents](https://magazine.sebastianraschka.com/p/using-local-coding-agents)
