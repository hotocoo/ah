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

## D25. Evidence-gated completion and verdicts (the Aletheia loop)

- **Chosen:** the harness keeps its own ledger of what tool calls actually did (`src/agent/evidence.ts`): files changed since the last passing check, checks passed and failed, and anomalies (failed actions, which are prediction errors against the implicit expectation that an action succeeds). A run that tries to end with changed files and no passing check since is asked once to verify. Every run gets a verdict (`verified`, `failed`, `unverified`, `none`) computed from the ledger, independent of the model's final text. JS/TS writes are syntax-checked in-process and a broken write counts as a failed action.
- **Rejected:** asking the model to emit an explicit prediction with every tool call (extra schema surface lowers small-model tool accuracy); trusting the model's "tests pass"; running the full test suite automatically after every edit (seconds to minutes per edit, and the right command is not always known).
- **Why:** completion and memory in current harnesses rest on the model's own account (see ARCHITECTURE-NEXT.md). One nudge costs one turn; the verdict makes unverified work visible either way. Ablation: `SessionFeatures.evidence = false` (included in `--baseline`).

## D26. Memory: harness-written lessons, trust updated by outcomes

- **Chosen:** SQLite FTS5 store in `~/.ah/memory.sqlite`. Three kinds with prior trust: `lesson` 0.8 (harness-written, only from anomalies resolved inside `verified` runs), `note` 0.5 (model or user claim), `episode` 0.3 (compaction summaries). Recall ranks by `bm25 × trust`, top 5, injected into the user message (not the system prompt, D4). Recalled memories move toward 1 after verified runs and toward 0 after failed ones; below 0.15 they are no longer recalled.
- **Rejected:** embeddings (a second model and a vector index for a store that holds hundreds of short entries; FTS5 is built into `bun:sqlite`); model-curated memory only (the poisoning loop described in arXiv 2608.00017); a separate memory per session.
- **Why a separate file from telemetry:** memory must work with telemetry disabled. Benchmarks switch memory off so trials stay independent.

## D27. MCP client hand-rolled

- **Chosen:** JSON-RPC 2.0 over stdio (newline-delimited) and Streamable HTTP (JSON or SSE replies, `Mcp-Session-Id`, `MCP-Protocol-Version`). Sends the 2025-11-25 `initialize` handshake and the 2026-07-28 per-request `_meta` protocol version; skips `initialize` when a stateless server answers `-32601`. Tools become `mcp__<server>__<tool>`, read-only only when annotated `readOnlyHint` and not `destructiveHint`, optional (hidden in the compact profile), sorted for a stable prompt.
- **Rejected:** `@modelcontextprotocol/sdk` (D1: one runtime dependency; `ah` needs three methods).
- **Why:** users paste existing Claude Desktop / Claude Code `mcpServers` blocks; failures are reported by `ah mcp` and the Extensions page, never fatal.

## D28. Plugins, skills and workspace trust

- **Chosen:** plugins are directories in `~/.ah/plugins` (or a trusted workspace's `.ah/plugins`) with `plugin.json` (or `.claude-plugin/plugin.json` and `.mcp.json`): MCP servers, instructions, a tool module exporting `Tool[]`, a skills folder. Skills follow the agentskills.io layout; only a name/description index enters the prompt and `skill_view` loads a body on demand.
- **Trust:** a repository can ship `.mcp.json`, `.ah/config.json` servers and plugins that start processes or load code. These load only when the workspace is in `trustedWorkspaces` in the user's `~/.ah/config.json` (`ah trust`, or the button on the Extensions page). The project's own config cannot mark itself trusted.
- **Rejected:** a marketplace or registry (discovery from disk covers local use; a registry adds a supply-chain surface); per-session approval prompts for each server.

## D29. Desktop control

- **Chosen:** `screenshot` and `computer` tools backed by what the OS provides, discovered at runtime: macOS `screencapture` + `sips`, CoreGraphics events through `osascript` JXA, System Events for keystrokes; Linux `xdotool` with `grim`/`gnome-screenshot`/`scrot`/`import`. Model text reaches scripts only through argv. Screenshots are scaled to at most 1280 px wide (`AH_SCREENSHOT_WIDTH`) and the model works in screenshot coordinates. `computerUse`: `off` (tools hidden), `ask` (default: every action, screenshots included, needs approval in every permission mode), `auto` (explicit opt-in).
- **Rejected:** `cliclick`/`pyautogui`/native addons (extra installs); Windows support without a machine to verify it on (reported as unavailable instead).
- **Why approval by default:** these actions leave the workspace confinement model entirely, and a screenshot can carry anything on screen to the model's provider. The web console streams approvals (`approval_request` over SSE, answered via `POST /api/approve`, "always allow" per session) and a live view of the latest screenshot.

## D30. Compaction rebuilds context from the task and harness evidence

- **Chosen:** summarising compaction produces `<task>` (verbatim) + `<evidence source="harness">` (`EvidenceLedger.snapshot()`) + `<notes source="model">`. When the only plain user message is the task prompt (one long task), the cut falls before an assistant turn instead, so long single tasks can be summarised at all.
- **Rejected:** model-only summaries (self-report compounding over repeated compactions); keeping the full transcript and relying on elision (overflows on long tasks).
- **Found by:** writing the test for this change. `safeCutIndex` only cuts at plain user messages, so a single-task run of any length never reached the summarise path.

## D31. Episodic reset on a failure streak

- **Chosen:** after `resetAfterFailures` (default 4) consecutive failed actions, the next turn starts from a rebuilt context (D30: task verbatim, harness evidence, model notes) instead of the growing transcript. The ledger, the workspace and the run continue; only the model's view is reset. Off with `evidence: false` (ablation) or `resetAfterFailures: 0`.
- **Rejected for now:** rolling the workspace back to the best checkpoint on a stall. It needs snapshots of the real workspace and deletes work, so it belongs behind an explicit opt-in, measured in benchmark sandboxes first.
- **Why:** in the 2026-09-24 suite run, `ts-feature-lru` failed 3/3 at the turn limit with 4 to 8 failed actions per trial: the model kept editing against its own earlier reasoning. A fresh episode keeps what is true (evidence) and drops the rest.

## D32. Output-cap cutoffs continue the run

- **Found by:** the first horizon trial (`py-optimal-scheduler`, MiMo Q8_0): after 4 turns and 24 minutes a reply hit the output cap while the model was still reasoning, with no tool call, and the loop ended the whole run as `max_tokens`.
- **Chosen:** a reply cut off at the output cap without a tool call gets a continuation message asking for a short concrete next step (at most twice per run, part of `recoveries`). Truncated tool inputs keep their existing handling (retry with a doubled budget).

## D33. Edit and path recovery from measured tool errors

- **Found by:** the telemetry of the 2026-09-23 MiMo-9B core run. 15 of 81 `edit_file` calls failed, against 2 of 44 in the baseline. The causes: `old_string` copied with read_file's `N\t` line prefixes or a stray `>` marker, repeat edits of changes already applied, and paths like `work/<task>/1/file` that repeat the workspace root shown in the prompt.
- **Chosen:** `confine()` drops leading path segments that repeat the root's trailing segments, but only when the root has no such directory. An edit miss is retried once with the copied prefixes stripped (strategy `prefix`, which the result reports to the model). A miss whose `new_string` is already in the file says so. All of this is off with `tolerantEdits: false`.

## D34. MCP revisions and deferred MCP tools

- **Found by:** installing context7. ah put `io.modelcontextprotocol/protocolVersion` into `_meta` on a 2025-11-25 session. Servers that speak both revisions read that key as a 2026-07-28 stateless envelope and reject the request because `clientCapabilities` is missing.
- **Chosen:** legacy sessions send no envelope. A server that does not implement `initialize` (-32601) gets the full 2026-07-28 envelope (version, clientInfo, clientCapabilities) and the matching header.
- **Deferred tools:** four common servers (context7, deepwiki, mcp-server-git, @playwright/mcp) have 42 tools, whose schemas cost 6,329 tokens with the Qwen3.8 tokenizer. That is six times ah's own tool set (1,017). `mcpTools: auto` replaces them with one `mcp` tool (the tool name is an enum) and a one-line index, 1,348 tokens in total. Bad arguments return the schema, so a model pays only for the tools it uses. Verified end to end: the local 27B used context7 through it, and its first bad call recovered from the returned schema.

## D35. Head-to-head through `--agent-cmd`

- **Chosen:** other harnesses run as a shell command in the same sandbox, under the same time limit and hidden grader. ah's runner, statistics and reports are reused; the runner contains no harness-specific code. `scripts/h2h.sh` wires Hermes (isolated `HERMES_HOME`, pointed at the same server) and dsh (headless profile).
- **Constraint:** Claude Code's permission classifier does not let an assistant session start `hermes --yolo` / dsh full-access agents, so the user launches the script.

## D36. Appearance and presets

- **Chosen:** a neutral grey system in light and dark (OS default, user override), Geist type on a 4 px grid. One `--accent-base` feeds a per-theme accent, clamped in lightness for contrast. Colour marks only interaction, selection and outcomes. The ambient canvas, grain and gradient washes were removed (a "vibe-coded" look, per the user). There is a ⌘K command palette, and tables have sticky headers. Lighthouse on the console: Accessibility 100, Best Practices 100. The uploaded wallpaper is one fixed file with a size cap, a magic-byte check and token auth, and the page shows it from a `blob:` URL. Presets are user-defined bundles (model, mode, turns, instructions); none are built in, per the no-hardcoding rule. The console never takes its permission mode from a preset.

## D37. Tool-error coaching (invented)

- **Gap:** harnesses reset what a model is told at every session. Hermes has in-session loop guardrails (`tool_loop_guardrails` in its config) but no cross-session memory of how a given model misuses tools. dsh's CLI bundle had no match for similar patterns.
- **Chosen:** ah already records every tool result per model. Error classes that recur (3 or more times across 2 or more of the model's last 40 runs) become up to three one-line hints in its system prompt. A model with a clean record pays zero tokens. On current telemetry, MiMo-9B gets 3 hints and Qwen3.8-27B gets none. This follows the memory switch, so bench trials stay independent. Measuring the gain needs an A/B run with memory on; that is not done yet.

## D38. Goal, verify, advisor, loop, graph

- **Asked for:** the commands users know from Claude Code (`/goal`, `/loop`, an advisor, a verifier, a code graph), without making ah heavier.
- **Chosen:** one shared reviewer (`src/agent/review.ts`) and one command dispatcher (`src/agent/commands.ts`) used by `ah chat` and the web console.
  - The **judge** behind `/goal`, `/verify` and self-paced `/loop` gets a fresh context: the criterion, the project's check re-run by the harness, `git status` plus `git diff HEAD`, the evidence ledger, and the transcript tail labelled as the agent's account. A failing check means "not met" whatever the model says (D25 applied to stopping). "Not met" sends the judge's reasons back to the model; the goal persists across runs until met or cleared. Claude Code's `/goal` evaluates the condition from the conversation; this one does not trust the conversation.
  - The **advisor** is the same reviewer with an advice prompt. It uses `advisorModel` when configured (any `provider/model`, resolved by discovery like every other model), else the session model with a fresh context. The `advisor` tool is offered to the agent only when a distinct `advisorModel` is set, so small models do not pay for a tool that would only ask themselves.
  - **`/graph`** replaces `repo_map` with a `graph` tool: the same declaration outline, plus a symbol's definitions, every reference attributed to its enclosing function or method (callers), and the declared functions its body calls. Language-agnostic declaration matching, no parser per language, no index on disk.
  - **`/loop`** is a few lines over `agent.run`: fixed interval until stopped (or N runs), or back to back until the judge says done.
- **Rejected:** a separate verifier agent with its own tool loop (a second loop to maintain; the check plus the diff carries the signal), a persistent graph database (the scan is fast enough for repositories of a few thousand files; `ponytail:` note in `graph.ts`).
- **Found while benchmarking:** a llama-server connection dropped mid-stream ("socket connection was closed unexpectedly") ended a trial as `agent_error`, because only connect-time failures were retryable. Stream read errors are now retryable `unavailable` errors too (`sseData`, `ndjson`).

## D39. Three more small-model slips (LFM2.5-2.6B bench)

- **Found by:** tool errors in the 2026-09-25 LFM2.5-2.6B core-suite run: 13 of 26 `bash` errors were `timeout_ms` under the 1000 ms minimum (the model passed seconds); 17 file-tool errors were absolute paths that rebuilt the workspace root wrong (dropped the trial directory, `.../rust-fix-compile-and-logic/Cargo.toml` for root `.../rust-fix-compile-and-logic/1`, or mixed in the suite directory); several `read_file` calls named a directory.
- **Chosen:** `timeout_ms` under 1000 is read as seconds. An absolute path outside the root whose tail exists inside it resolves to that file (longest tail first; still confined, and a tail that does not exist still errors). `read_file` on a directory returns its listing. Each turns a wasted turn into the result the model wanted.
