# Roadmap and known limitations

## Known limitations (honest status)

- **Verified live** on this machine (Apple M4 Max, 64 GB): llama.cpp `llama serve` with MiMo-V2.6-Distill-Qwen-9B Q8_0 GGUF (full benchmark suite, ablation), `optiq serve` (mlx-lm) with MiMo-V2.6-Distill-Qwen-9B OptiQ 4-bit (full suite; requires the one-field parser fix below), Ollama (agent runs), ComfyUI image generation (SD 1.5), procedural 3D designed by a local model. **Implemented, tested against fake servers only**: LM Studio, sdapi servers, vLLM/SGLang, Anthropic, Gemini, OTLP export to a real collector.
- **Upstream issue (mlx-community/MiMo-V2.6-Distill-Qwen-9B-OptiQ-4bit)**: its `tokenizer_config.json` declares `"tool_parser_type": "json_tools"`, but the chat template emits Qwen3-Coder XML (`<tool_call><function=…><parameter=…>`). mlx-lm therefore drops every tool call (`finish_reason: tool_calls`, no `tool_calls`), on `/v1/chat/completions`, `/v1/messages`, `/v1/responses` and even `/v1/completions`. `ah` detects this and falls back to its text protocol, but the server strips the call tokens before `ah` can see them. Workaround used for the benchmark: a local copy of the snapshot with only that field set to `qwen3_coder` (weights symlinked), served with the recommended `optiq serve --model <dir>`.
- Image-to-3D servers (Hunyuan3D, TRELLIS) are not wired in; 3D is procedural (primitives) only.
- Token counts before a request are estimated (≈4 chars/token); exact counts come from the runtime afterwards.
- `ah chat` has no rich TUI (line-based REPL); the web app is the richer interface.
- No sandbox container for the agent's shell commands (workspace confinement is path-level; commands run as the user). Benchmarks run in throwaway directories.
- Windows is untested; desktop control reports itself unavailable there.
- Desktop control verified live on macOS (screenshot, cursor, move, scroll through the tool; approval flow in the web console with a scripted model). The Linux xdotool backend is implemented but not verified on a real X11 session. It needs the Screen Recording and Accessibility permissions for the terminal on macOS.
- MCP client tested against fake stdio and HTTP servers; not yet against a large third-party server catalog.
- Evidence-loop check detection is heuristic: the detected test command, or a shell segment that runs a toolchain program (heredocs, quotes and text-only programs ignored, D44). Lessons record what was done, not why.
- Head-to-head measured only against Hermes Agent and dsh (installed here). On LFM2.5-2.6B at 5 trials, ah is significantly ahead of Hermes (24/40 vs 10/40), not yet of dsh (13/40). Long horizon on Qwen3.8-27B was 2 trials on one task (ah 65/122 checks, Hermes 7/122), and no harness finished a long-horizon task within its limit.
- `bash` reports the files it wrote only in git workspaces (D44).

## Done since the last roadmap (2026-09-25/26)

- `/goal`, `/verify`, `/advisor`, `/loop`, `/graph` (D38); the independent judge behind them answers MET / NOT MET / BLOCKED.
- A failing check sends the model back with the failing lines, up to `gateRetries` times (D43); a heredoc write no longer counts as a passing check (D44).
- Small-model slips found by benchmarking fixed: seconds as timeouts, misplaced absolute paths, new files beside the root, runner-specific test filters, broken tool-call JSON, server-side tool-parse failures, dropped streams (D39, D41, D42, D45, D46).
- Bench trials run alone in private directories (D40); `--no-turn-limit` gives ah the external harnesses' time-only budget.
- Recursive deletion of the workspace needs approval (D47); runtime refs survive another server stopping (D48).

## Next

0. Settle ah vs dsh: point dsh at the same model and run more trials; run the 27B on the whole horizon suite with 3+ trials.

1. Container sandbox (`--sandbox docker`) for agent shell commands and bench trials.
2. Image-to-3D adapters (Hunyuan3D-2 API server, TRELLIS.2) and a text → image → 3D pipeline.
3. Grammar-constrained tool calls for llama.cpp (`response_format` json_schema) as an opt-in, measured on the bench (watch the "constraint tax").
4. Runtime management: pull/load/unload models from `ah` (Ollama `/api/pull`, LM Studio `/api/v1/models/load`, llama.cpp router mode), with memory-fit checks from Hugging Face GGUF metadata.
5. Larger benchmark suites (SWE-bench-style repositories via git fixtures) and best-of-n / verifier modes.
6. OTLP metrics export; Prometheus endpoint.
7. LSP diagnostics after edits (today: in-process JS/TS syntax check only).
8. Calibration-aware autonomy: per-model surprise rates from telemetry shown before enabling `computerUse: "auto"` (ARCHITECTURE-NEXT.md).
9. Evidence-weighted skill distillation: promote high-trust, repeatedly winning lessons into agentskills.io skills.
10. Counterfactual replay: re-run failed bench trials with a recalled lesson injected to measure whether lessons cause fixes.
