# Design decisions

Each entry: the decision, the alternatives considered, and why.

## D1. Runtime: Bun, TypeScript, one runtime dependency

- **Chosen:** Bun 1.4 (TypeScript executed directly, `bun:sqlite`, `bun test`, `Bun.serve`, `bun build --compile` for a single `ah` binary).
- **Rejected:** Node 22 with type stripping (works, but no bundled SQLite driver without a flag, no single-file compile), Python (weaker streaming/TUI story, slower cold start for a CLI).
- **Why:** the harness must be an installable application. `bun build --compile` produces one self-contained executable; SQLite, HTTP server and test runner are built in, so the only runtime dependency is `@anthropic-ai/sdk`.

## D2. Provider-neutral message model

- All adapters convert to and from `src/core/types.ts` (`Message`, `ContentBlock`, `StreamEvent`, `Usage`). The agent loop, telemetry and benchmarks never see vendor wire formats.
- Five adapters cover everything: `anthropic` (official SDK), `openai-compatible` (raw fetch; OpenAI and ~15 gateways/local servers), `gemini` (native REST), `ollama` (native REST), `mock`.

## D3. Anthropic through the official SDK, others through fetch

- Anthropic's own guidance is to use the official SDK and its typed errors and helpers (`stream().finalMessage()`), not an OpenAI-compatible shim.
- Other vendors are reached with `fetch` because their wire formats are stable and small and pulling four more SDKs would bloat the compiled binary.

## D4. Anthropic request shape

- Thinking mode and effort levels come from the Models API (`capabilities.thinking.types.{adaptive,enabled}`, `capabilities.effort.*`), cached per model, never from model-name patterns. Adaptive thinking plus `output_config.effort` when supported; `budget_tokens` (clamped to `[1024, max_tokens - 1024]`) only for models whose capabilities list budget thinking without adaptive.
- `eager_input_streaming: true` on every client tool (streamed requests), so large `write_file` bodies stream instead of arriving in one burst. Consequence: the SDK's tolerant parser can produce truncated inputs, so every tool input is schema-validated before running (D7), and `max_tokens` turns with tool calls are never executed.
- Server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) are sent by default; if the API rejects them for a model or account, `ah` drops them and remembers. Opt out with `serverFallbacks: false`.
- Top-level `cache_control: {type: "ephemeral"}` enables automatic prompt caching. The system prompt is byte-stable within a session (sorted tool list, day-granularity date) so the cached prefix keeps hitting.
- No assistant prefill and no forced `tool_choice` (both rejected by current models).

## D5. OpenAI-compatible divergences are learned, not tabulated

Servers that claim compatibility disagree on parameters (`max_tokens` vs `max_completion_tokens`, `reasoning_effort` vs `reasoning: {effort}`, `stream_options`, accepted effort values). There is no per-vendor table. The adapter starts from one default wire format and, when a server rejects a request with a 400 (or a 500 raised by a chat template) that names one of these parameters, corrects the format, retries (max 3), and persists the learned format per `provider:model` in SQLite. Example observed live: a Qwen3.8 GGUF chat template raised `Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low`; `ah` learned `[xhigh, medium, low]` and maps requests to the nearest value. Template exceptions are marked non-retryable (retrying the same request cannot succeed).

## D6. Normalised usage semantics

`Usage.inputTokens` **includes** cache-read and cache-write tokens; `outputTokens` **includes** reasoning tokens. Anthropic reports cached tokens separately, so its adapter adds them; OpenAI and Gemini already include them. Cost is then `uncached*in + cacheRead*cr + cacheWrite*cw + output*out`. Unknown pricing yields `null`, never an estimate.

## D7. Error contracts between providers and the loop

- `ProviderError.retryable`: 408/409/429/5xx and connection errors. The loop retries with exponential backoff and jitter (max 3).
- `ProviderError.code = "invalid_tool_json"`: tool-call arguments could not be parsed. The loop re-issues the turn (no backoff), at most 2 consecutive times. There is no in-band sentinel; the adapter throws.
- `ProviderError.code = "context_overflow"`: HTTP 400 whose body matches a context-limit pattern. The loop forces summarising compaction and retries the turn once.
- `stop_reason = refusal`: the run ends with outcome `refusal`; tools from that turn are not run.
- `stop_reason = max_tokens` with tool calls: tools are never run (a truncated input can parse as a valid partial object). The turn is retried once with double `max_tokens`, clamped to the model's output cap.

## D8. Ollama `think` is capability-gated

Sending `think` to a model without the `thinking` capability returns HTTP 400. The adapter reads `/api/show` capabilities (cached per model) and only sends `think` when supported.

## D9. Tools are validated, confined and permission-gated

- Every tool input is validated against its JSON Schema before execution; failures go back to the model as `is_error` tool results.
- All paths are confined to the workspace root, including symlink escapes (realpath of the deepest existing ancestor).
- `edit_file`/`multi_edit` require a prior `read_file` in the session; `write_file` refuses to overwrite unread files.
- Permission modes: `ask` (writes need approval), `auto`, `read-only` (write tools hidden and blocked). Dangerous shell patterns (sudo, `rm -rf /`, force push, `curl | sh`, ...) need approval in every mode.
- `web_fetch` refuses loopback, link-local and private addresses (SSRF guard).

## D10. Telemetry is loop-side, SQLite is the source of truth

The loop emits a typed `AgentEvent` stream (`src/agent/events.ts`) with TTFT measured at the first streamed delta. Sinks fan out from one handler: SQLite (WAL), JSONL, OTLP/HTTP JSON, CLI renderer, web UI (SSE). Benchmark trials write to the same `runs` table with bench columns set, so there is one store.

## D11. OTLP hand-rolled, not the OpenTelemetry SDK

The OTel JS SDK is ~20 packages. The OTLP/HTTP JSON trace schema is small and stable, so `ah` builds `resourceSpans` directly with GenAI semantic-convention attributes (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`, `gen_ai.tool.name`). Metrics are derived from SQLite; OTLP metrics export is roadmap.

## D12. Model discovery merges live sources only

`models.dev/api.json` (pricing, limits, modalities), OpenRouter's catalog, and each discovered runtime's own listing (`/api/tags` + `/api/show`, `/v1/models`, `/props`, LM Studio `/api/v0/models`). Cached in SQLite (24h; runtime listings 1h). There is **no built-in model table**: offline with an empty cache, `ah` knows exactly the models its local runtimes report. Model kinds come from declared output modalities or runtime capabilities, never from name patterns. For local runtimes, runtime-reported metadata (context, capabilities, KV geometry) beats catalog fuzzy matches.

## D13. "Modeling" means 3D model generation

The request says "built in image gen modeling must included". Read as: image generation **and** 3D modelling are built in. Both are local-first: image backends are discovered (ComfyUI, stable-diffusion.cpp / A1111 `sdapi`, Ollama image models when a real request succeeds) with cloud image APIs as optional extras. 3D uses a keyless **procedural** backend (the language model writes a structured scene, `ah` compiles it to GLB/glTF/OBJ/STL and renders a PNG preview) and a text -> image -> image-to-3D pipeline for user-configured local servers (Hunyuan3D, TRELLIS).

## D14. Benchmarks grade with shell commands in a sandboxed copy

A task is a fixture + prompt + grader command (exit 0 = pass). Each trial copies the fixture into a fresh directory, runs the agent confined there, then runs the grader. This makes tasks deterministic, model-agnostic and runnable offline against scripted mock solutions (which prove harness plumbing, not model quality).

## D15. Repository visibility: private

The GitHub repository is created private. Private to public is reversible; public to private is not (content may already be cached or indexed).

## D16. Local-first

`ah` (Aletheia Harness) targets models served on the user's machine first: Ollama, llama.cpp `llama-server`, MLX servers, LM Studio, vLLM/SGLang, ComfyUI. Cloud providers are optional extras. Every design choice below follows from what local runtimes actually do (see `RESEARCH-LOCAL.md`).

## D17. What "no hardcoding" covers

- **Removed:** model lists, prices, default model ids, provider/vendor presets (base URLs, ports, env var names, wire flags), model-name regexes for capabilities, provider alias maps.
- **Replaced by:** runtime discovery (listening ports + API fingerprints), models.dev provider metadata (`api`, `env`, `npm` -> adapter), Anthropic Models API capabilities (`thinking.types`, `effort`), runtime capabilities (Ollama `/api/show`, llama.cpp `/props`), learned wire formats, user config.
- **Kept on purpose:** the handful of wire protocols `ah` speaks (Anthropic Messages, OpenAI Chat Completions, Gemini, Ollama native) and the API signatures used to fingerprint runtimes; safety rules (dangerous shell patterns, SSRF ranges); repository conventions (ignored dirs, instruction file names). These are protocol implementations and policy, not model or vendor data.
- **Tunables with defaults** (memory fraction, minimum agent context, compact-tools ratio, turn limits) live in config and are documented, not scattered in code.

## D18. Runtime discovery over presets

Candidates: config endpoints, localhost URLs in `*_HOST`/`*_BASE_URL`/`*_ENDPOINT` env vars, and every locally listening TCP port (`lsof`, or `ss` on Linux). Each candidate gets a liveness check then all fingerprint probes in parallel; the most specific match wins (Ollama `/api/version` > llama.cpp `/props` > ComfyUI `/system_stats` > `sdapi` > LM Studio > generic `/v1/models`). Identical listeners (same kind, version and models) are deduplicated. Measured: ~1.2 s on a machine with 30 listening ports.

## D19. Context window sizing for local models

Order: runtime-fixed context (llama.cpp `n_ctx`, LM Studio loaded context, **Ollama model already resident per `/api/ps`**) > user config capped by the trained maximum (`<arch>.context_length`) > trained maximum; then capped by memory: `(total * fraction - weights - other GPU allocations) / kv_bytes_per_token`, where `kv_bytes_per_token = 2 * layers * kv_heads * head_dim * bytes_per_element` from GGUF metadata. Rounded down to a power of two and persisted per model, because Ollama reloads the model whenever `num_ctx` changes. `num_ctx` is always sent explicitly (Ollama otherwise truncates silently). A truncation detector compares the runtime's reported prompt tokens with `ah`'s estimate and forces compaction.

## D20. Tool surface follows context and backends

Tools declare `available(ctx)` (media tools need a backend, `git_status` needs a repo) and `optional`. Unavailable tools are never offered; when the window is small relative to prompt + tool definitions (`compactToolsRatio`), optional tools are dropped. Observed motivation: a 0.6B model called `generate_3d` with no backend configured.

## D21. Lessons from live verification

Bugs that only appeared against real local runtimes, each now covered by a test:

- **Bun's implicit 300 s `fetch` timeout** killed long local prefills and requests queued behind other clients (measured: aborts at 300 123 ms). Model streams use `timeout: false`; cancellation is by AbortSignal only.
- **Errors inside an SSE stream** (`data: {"error": {"code": 500, "message": "Compute error."}}`) were read as an empty answer and counted as a completed run. They are now retryable `ProviderError`s, and an empty reply is always an error.
- **Chat templates enforce their own parameter values** (`Unexpected reasoning effort high. Supported types are xhigh, medium, and low`); learned per model (D5).
- **Runtimes spawn internal servers**: Ollama's per-model llama.cpp runner listens on a random port and answers `/props`. Listeners whose parent process is a runtime of a different kind are skipped; same-kind parent/child listeners are merged.
- **Busy servers answer slowly**: fingerprint probes use a 2.5 s timeout so a llama-server busy with a long prefill is still discovered.
- **Reasoning models with thinking disabled reason in the content** and never reach the JSON; the 3D designer lets them think in their own channel and constrains the answer with a JSON schema (`responseSchema` → Ollama `format`, OpenAI `response_format`).
- **Every request to a local runtime must carry the context window.** One `ah 3d` call without `num_ctx` made Ollama load qwen3:4b at its 256k default (43 GB resident); the next benchmark reused that "resident" context and the runner crashed (`unexpected EOF`). Context resolution is now one function used by every path (agent, 3D, throughput, web app), and a resident context is reused only if it fits the memory budget. In-stream runner errors are retryable.
- **Never benchmark two runtimes concurrently on shared unified memory.** Running an Ollama benchmark and ComfyUI next to a 27B llama-server that another client was also driving preceded that server getting stuck in `Compute error.` for every request. Benchmarks are now run one runtime at a time.

## D22. Edits tolerate indentation slips; empty turns are nudged

Observed on qwen3:4b: six consecutive failed `edit_file` calls because `old_string` used 4 spaces or a tab where the file had 2, and turns that ended with only hidden reasoning (no reply, no tool call). Now:

- `edit_file`/`multi_edit` try an exact match first; if none, a line-by-line match ignoring leading/trailing whitespace. A unique match is applied with `new_string` re-indented to the file's actual indentation, and the tool result says so. Ambiguous matches are still rejected. CRLF files keep CRLF.
- A miss returns the closest file lines with line numbers, so the next attempt can copy the exact text.
- A turn with neither text nor tool calls gets a continuation message (at most twice per run) instead of being reported as a completed task.

## D23. Tool subprocess hygiene

Found during the MiMo baseline run: `npx vitest run 2>&1 | tail -30` outlived both the 120 s command timeout and the 900 s trial limit, because killing `sh` left `npm exec` → `node` → vitest workers holding the pipe open. The same process listing showed that commands inherited the harness's full environment, including session tokens. Commands now run with credential-like variables removed, and timeouts/aborts kill the entire process tree and stop waiting on the pipes one second later.

## D24. Serve and sample models the way their authors recommend

Models are served with the command from their model card (`llama serve -hf ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF`, `optiq serve --model mlx-community/...`), and `ah` applies the card's generation settings itself: it resolves the Hub repo from the runtime's model id or cache path, reads `generation_config.json` (following `base_model` from quantised repos, e.g. GGUF → `XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B`: temperature 0.6, top_p 0.95, top_k 20), and sets `chat_template_kwargs.enable_thinking` when the template has that switch (the MiMo card enables thinking). Per-model config overrides both. For runtimes without GGUF metadata (MLX, vLLM), `config.json` supplies the trained context and KV geometry, counting only full-attention layers in hybrid models (MiMo/Qwen3.5: 8 of 32).

Two more robustness features came out of these runs: project facts in the system prompt (the model stopped guessing `deno`/`node` for a Bun project; trial pass rate on the first two tasks went from 3/5 to 6/6), and a repetition guard (one turn otherwise generated for 13 minutes).
