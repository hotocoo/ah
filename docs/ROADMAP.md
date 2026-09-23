# Roadmap and known limitations

## Known limitations (honest status)

- **Verified live** on this machine: Ollama (qwen3:0.6b, qwen3:4b, qwen3:14b: agent runs and full benchmark suites), llama.cpp `llama-server` (Qwen3.8 27B Q6_K: interactive fixes and two benchmark trials; the full suite could not complete because the shared server got stuck returning `Compute error.` and needs a restart by its owner), ComfyUI image generation (SD 1.5), procedural 3D designed by a local model. **Implemented, tested against fake servers only**: LM Studio, sdapi servers, vLLM/SGLang/mlx_lm (generic OpenAI-compatible path), Anthropic, Gemini, OTLP export to a real collector.
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
