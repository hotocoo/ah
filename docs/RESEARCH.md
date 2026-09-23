# Research notes

What was investigated before and during the build, with the conclusions that shaped `ah`. Dates: September 2026.

## 1. Existing coding harnesses surveyed

| Project | Stars (Sep 2026) | Takeaway for `ah` |
|---|---|---|
| `earendil-works/pi` (pi-mono) | ~108k | Unified LLM API + agent loop + TUI in one toolkit. Confirms the provider-neutral core + thin adapters architecture. |
| `anomalyco/opencode` | ~209k | Uses models.dev as its model catalog. Adopted the same catalog for pricing and limits. |
| `Aider-AI/aider` | ~49k | Repo map (symbol outline) is the cheapest orientation tool for a coding agent. Implemented `repo_map`. |
| `SWE-agent/mini-swe-agent` | ~8k | "100-line agent" scoring >74% on SWE-bench Verified: the loop can be simple if tools and prompt are good. Kept the loop small and put effort into tools, validation and error feedback. |
| `harbor-framework/terminal-bench` | ~2.6k | Tasks = container + instruction + test script. Adopted the "grader is a shell command in a sandbox" model for `ah bench`. |

Common patterns across all of them, adopted here:
- Exact-string edit tools (with uniqueness requirement) beat whole-file rewrites and diff formats for reliability.
- Tool errors are returned to the model as results, never thrown out of the loop.
- Read-before-edit guard prevents blind edits.
- Output truncation (head + tail) keeps shell output from flooding context.
- Project instruction files (`AGENTS.md`, `CLAUDE.md`) are loaded into the system prompt.

## 2. Model catalog: models.dev

`GET https://models.dev/api.json` returns `{ [providerId]: { id, env[], npm, api, name, doc, models: { [modelId]: {...} } } }`.
Per-model fields used: `name`, `family`, `attachment`, `reasoning`, `tool_call`, `structured_output`, `temperature`, `release_date`, `modalities.input[]`, `modalities.output[]`, `open_weights`, `limit.context`, `limit.output`, `cost.input`, `cost.output`, `cost.cache_read`, `cost.cache_write` (USD per million tokens).

OpenRouter `GET /api/v1/models` returns `data[]` with `id`, `context_length`, `architecture.input_modalities/output_modalities`, `pricing.prompt/completion/input_cache_read` (USD per token, as strings), `top_provider.max_completion_tokens`, `supported_parameters[]`.

## 3. Anthropic Messages API (current as of Sep 2026)

Source: bundled `claude-api` skill documentation.
- Current model ids: `claude-opus-5` (default), `claude-opus-5-5`, `claude-fable-5-1`, `claude-sonnet-5`, `claude-haiku-4-5`, older 4.x.
- Thinking: `{type: "adaptive"}` on current models; `budget_tokens` rejected (400) on Opus 5 / Fable 5.x / Sonnet 5 / Opus 4.7-4.8; still required on Haiku 4.5. Depth via `output_config.effort` (`low|medium|high|xhigh|max`). Opus 5.5 cannot disable thinking and defaults to `medium` effort.
- No assistant prefill on current models; forced `tool_choice` (`any`/`tool`) returns 400 on Opus 5.5 / Fable 5.1.
- Streaming with client tools: set `eager_input_streaming: true`; validate tool inputs yourself (tolerant partial-JSON parser); never run tools from a `max_tokens` or `refusal` turn; unparseable JSON makes `finalMessage()` reject with an `AnthropicError` ("Unable to parse tool parameter JSON").
- Refusals: `stop_reason: "refusal"` with `stop_details`; server-side fallbacks via `fallbacks: "default"` + beta `server-side-fallback-2026-07-01`.
- Models API: `GET /v1/models` returns `max_input_tokens`, `max_tokens`, `capabilities.{image_input,pdf_input,thinking,effort,...}.supported`.
- Top-level `cache_control: {type: "ephemeral"}` enables automatic prompt caching; verify via `usage.cache_read_input_tokens`.
- Preserved thinking: editing earlier turns invalidates thinking blocks, so the harness keeps history append-only and strips thinking blocks when compaction rewrites history.

## 4. OpenAI Chat Completions and compatible servers

- Streaming SSE; tool calls arrive as `choices[0].delta.tool_calls[{index, id?, function:{name?, arguments}}]` fragments keyed by `index`; `finish_reason: "tool_calls"`.
- Usage in the final chunk only when `stream_options: {include_usage: true}`; `prompt_tokens` includes `prompt_tokens_details.cached_tokens`; reasoning in `completion_tokens_details.reasoning_tokens`.
- Divergences found: `max_completion_tokens` (OpenAI) vs `max_tokens` (everyone else); `reasoning_effort` (OpenAI) vs `reasoning: {effort}` (OpenRouter); DeepSeek/vLLM stream reasoning as `delta.reasoning_content`, OpenRouter as `delta.reasoning`.
- Images: `POST /images/generations` returns `data[].b64_json` (gpt-image-1) or `url`.

## 5. Google Gemini (Generative Language API v1beta)

- `POST /models/{model}:streamGenerateContent?alt=sse`, key in `x-goog-api-key`.
- `contents[{role: user|model, parts[]}]`, `systemInstruction`, `tools[{functionDeclarations[]}]`, `generationConfig.thinkingConfig`.
- Function calls are whole (not streamed fragments); Gemini 3 attaches `thoughtSignature` to function-call parts that must be echoed back, so `ToolCallBlock.signature` round-trips it.
- Schema dialect rejects `additionalProperties`, `$schema`, `default`; the adapter strips them.
- Imagen: `:predict` with `instances[{prompt}]` returns `predictions[].bytesBase64Encoded`. Gemini image models return `inlineData` parts with `responseModalities: ["TEXT","IMAGE"]`.

## 6. Ollama

- `POST /api/chat` streams NDJSON; tool calls arrive complete in `message.tool_calls[{function:{name, arguments(object)}}]`; tool results are `role: "tool"` with `tool_name`.
- Final chunk: `done: true`, `done_reason`, `prompt_eval_count`, `eval_count`.
- `POST /api/show` returns `capabilities` (`completion`, `tools`, `vision`, `thinking`, `embedding`) and `model_info.*.context_length`.
- `think` on a non-thinking model returns 400, hence capability gating.
- Verified live against Ollama 0.34.1 with `qwen3:0.6b`.

## 7. Telemetry

- OpenTelemetry GenAI semantic conventions define `gen_ai.system`, `gen_ai.request.model`, `gen_ai.response.finish_reasons`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.tool.name`. Using these names makes spans render in Langfuse, Grafana Tempo, Honeycomb and Datadog without mapping.
- OTLP/HTTP JSON: `POST {endpoint}/v1/traces` with `{resourceSpans:[{resource:{attributes}, scopeSpans:[{scope, spans:[{traceId(32 hex), spanId(16 hex), parentSpanId, name, kind, startTimeUnixNano, endTimeUnixNano, attributes[], status}]}]}]}`.

## 8. Benchmark statistics

- **pass@k** (unbiased estimator, Chen et al. 2021): `1 - C(n-c, k) / C(n, k)` for `n` trials with `c` passes.
- **pass^k** (tau-bench, Yao et al. 2024): probability all `k` independent trials pass, estimated `C(c, k) / C(n, k)`. Measures reliability rather than capability.
- **Wilson score interval** for pass rates: stable at small `n` and at 0% / 100%, unlike the normal approximation.
- Regression detection compares candidate vs baseline per task and flags a change only when the Wilson intervals do not overlap.
