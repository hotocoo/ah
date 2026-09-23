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

- Adaptive thinking (`thinking: {type: "adaptive"}`) plus `output_config.effort` on current models; legacy `budget_tokens` only for models that still need it (Haiku 4.5 and older), clamped to `[1024, max_tokens - 1024]`.
- `eager_input_streaming: true` on every client tool (streamed requests), so large `write_file` bodies stream instead of arriving in one burst. Consequence: the SDK's tolerant parser can produce truncated inputs, so every tool input is schema-validated before running (D7), and `max_tokens` turns with tool calls are never executed.
- Server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) are on by default for Opus 5 / Fable 5.x / Mythos 5.x. Opt out with `serverFallbacks: false`.
- Top-level `cache_control: {type: "ephemeral"}` enables automatic prompt caching. The system prompt is byte-stable within a session (sorted tool list, day-granularity date) so the cached prefix keeps hitting.
- No assistant prefill and no forced `tool_choice` (both rejected by current models).

## D5. OpenAI-compatible divergences are explicit options, not guesses

Servers that claim compatibility disagree on parameters. The adapter exposes:

| Option | Values | Default | Why |
|---|---|---|---|
| `maxTokensParam` | `max_tokens` / `max_completion_tokens` | `max_tokens` | Only OpenAI requires `max_completion_tokens`; llama.cpp, older vLLM, LM Studio reject it. |
| `reasoningParam` | `openai` / `openrouter` / `none` | `none` | OpenAI uses `reasoning_effort`; OpenRouter uses `reasoning: {effort}`; most servers reject both. |
| `streamUsage` | boolean | `false` | `stream_options.include_usage` is needed for token counts on OpenAI-style servers but rejected by some. |

Presets in `src/providers/registry.ts` set these per vendor.

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

## D12. Model discovery merges three sources

`models.dev/api.json` (pricing, limits, modalities for hundreds of providers), each provider's live listing (`/v1/models`, `/api/tags`, Gemini `models.list`), and OpenRouter's catalog. Cached in SQLite with a 24h TTL. The catalog feeds context window, output cap and pricing into the agent.

## D13. "Modeling" means 3D model generation

The request says "built in image gen modeling must included". Read as: image generation **and** 3D modelling are built in. Image generation uses provider APIs (OpenAI, Gemini/Imagen, xAI, Together, fal, Stability) plus a keyless mock. 3D uses a keyless **procedural** backend (the language model writes a scene description, `ah` compiles it to GLB/glTF/OBJ/STL and renders a PNG preview) plus hosted text-to-3D APIs (fal, Meshy, Tripo) when keys are present.

## D14. Benchmarks grade with shell commands in a sandboxed copy

A task is a fixture + prompt + grader command (exit 0 = pass). Each trial copies the fixture into a fresh directory, runs the agent confined there, then runs the grader. This makes tasks deterministic, model-agnostic and runnable offline against scripted mock solutions (which prove harness plumbing, not model quality).

## D15. Repository visibility: private

The GitHub repository is created private. Private to public is reversible; public to private is not (content may already be cached or indexed).
