# Roadmap and known limitations

## Known limitations (honest status)

- **Verified live** on this machine (Apple M4 Max, 64 GB): llama.cpp `llama serve` with MiMo-V2.6-Distill-Qwen-9B Q8_0 GGUF (full benchmark suite, ablation), `optiq serve` (mlx-lm) with MiMo-V2.6-Distill-Qwen-9B OptiQ 4-bit (full suite; requires the one-field parser fix below), Ollama (agent runs), ComfyUI image generation (SD 1.5), procedural 3D designed by a local model. **Implemented, tested against fake servers only**: LM Studio, sdapi servers, vLLM/SGLang, Anthropic, Gemini, OTLP export to a real collector.
- **Upstream issue (mlx-community/MiMo-V2.6-Distill-Qwen-9B-OptiQ-4bit)**: its `tokenizer_config.json` declares `"tool_parser_type": "json_tools"`, but the chat template emits Qwen3-Coder XML (`<tool_call><function=…><parameter=…>`). mlx-lm therefore drops every tool call (`finish_reason: tool_calls`, no `tool_calls`), on `/v1/chat/completions`, `/v1/messages`, `/v1/responses` and even `/v1/completions`. `ah` detects this and falls back to its text protocol, but the server strips the call tokens before `ah` can see them. Workaround used for the benchmark: a local copy of the snapshot with only that field set to `qwen3_coder` (weights symlinked), served with the recommended `optiq serve --model <dir>`.
- Image-to-3D servers (Hunyuan3D, TRELLIS) are not wired in; 3D is procedural (primitives) only.
- Token counts before a request are estimated (≈4 chars/token); exact counts come from the runtime afterwards.
- `ah chat` has no rich TUI (line-based REPL); the web app is the richer interface.
- No sandbox container for the agent's shell commands (workspace confinement is path-level; commands run as the user). Benchmarks run in throwaway directories.
- Windows is untested.

## Next

1. Container sandbox (`--sandbox docker`) for agent shell commands and bench trials.
2. Image-to-3D adapters (Hunyuan3D-2 API server, TRELLIS.2) and a text → image → 3D pipeline.
3. Grammar-constrained tool calls for llama.cpp (`response_format` json_schema) as an opt-in, measured on the bench (watch the "constraint tax").
4. Runtime management: pull/load/unload models from `ah` (Ollama `/api/pull`, LM Studio `/api/v1/models/load`, llama.cpp router mode), with memory-fit checks from Hugging Face GGUF metadata.
5. Larger benchmark suites (SWE-bench-style repositories via git fixtures) and best-of-n / verifier modes.
6. OTLP metrics export; Prometheus endpoint.
7. LSP diagnostics after edits.
