# ah — Aletheia Harness

A local-first coding agent harness. `ah` finds the model runtimes on your machine, sizes every request to what the model and your memory can actually hold, repairs the tool-calling and wire-format quirks of local servers, and measures everything: per-turn latency, TTFT, prefill/decode speed, KV-cache reuse, GPU utilisation, memory and energy. It ships with a sandboxed multi-language coding benchmark, built-in image generation and 3D modelling, a CLI and a local web app.

Nothing about models or vendors is hardcoded: runtimes are discovered by port scan and API fingerprint, capabilities come from the runtimes themselves, cloud providers (optional) come from the models.dev catalog, and wire-format differences are learned from server errors.

- **Runtimes**: Ollama, llama.cpp `llama-server`, LM Studio, ComfyUI, stable-diffusion.cpp / A1111 (`sdapi`), and anything OpenAI-compatible (mlx_lm.server, vLLM, SGLang, vllm-mlx, LocalAI...). Optional cloud: Anthropic (official SDK), Gemini, and every OpenAI-compatible provider listed on models.dev.
- **Models**: live runtime listings + models.dev + OpenRouter, searchable by kind (chat, image-gen, 3d-gen, embedding, tts), modality, context, tool support, cost.
- **Agent**: 15 validated, workspace-confined, permission-gated coding tools; retries, compaction, silent-truncation detection, text tool-call recovery (12 formats) and a text tool protocol for models without native tool calling.
- **Telemetry**: SQLite + JSONL + OTLP (GenAI semantic conventions); hardware per turn.
- **Benchmarks**: 8-task suite (TypeScript, Python, Go, Rust; bugfix, feature, refactor, cross-file debugging, compile errors, mutation-graded test writing) with hidden graders; pass@k, pass^k, Wilson intervals; ablation mode; serving throughput benchmark.
- **Media**: ComfyUI / sdapi / provider image generation; procedural 3D modelling to GLB/glTF/OBJ/STL with rendered previews.

## Install

Requires [Bun](https://bun.sh) ≥ 1.4.

```bash
git clone https://github.com/hotocoo/ah && cd ah
bun install
bun run build            # single binary: dist/ah
./dist/ah doctor         # or: bun src/cli/main.ts doctor
```

## Use

```bash
ah doctor                                   # runtimes, models, hardware found on this machine
ah run "the tests in src/ fail, fix them"   # one task in the current directory (asks before writes)
ah run --yes -m llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF "add a --json flag to the CLI and a test for it"
ah chat                                     # interactive session
ah models coder --local --tools             # search the catalog
ah bench run --model llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF --trials 3
ah bench throughput --model llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF
ah telemetry                                # latency / TTFT / tok/s / cache / tool health
ah image "isometric server rack" -o rack.png
ah 3d "a wooden desk with a lamp" -o desk.glb
ah serve                                    # local web app
```

Example `ah run` on MiMo-V2.6-Distill-Qwen-9B (Q8_0 GGUF, served with `llama serve -hf ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF`):

```
context window 262144 (fixed by the runtime at load time) · tools native
sampling: temp 0.6 top_p 0.95 top_k 20 template {"enable_thinking":true} (model card XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B)
  ⏵ read math.test.ts       ✓ read_file 1ms
  ⏵ read math.ts            ✓ read_file 0ms
  turn 3: 1.1s ttft 377ms · in 2744 out 41 · prefill 598.6 tok/s decode 46.8 tok/s
  ⏵ edit math.ts            ✓ edit_file 0ms · math.ts
  ⏵ run tests               ✓ run_tests 9ms
Fixed. The bug was in `math.ts`: `add` subtracted instead of adding.
■ completed · 5 turns · 5 tools (0 err) · 9.0s · in 13408 out 232
```

Sampling comes from the model's own `generation_config.json` on Hugging Face (followed from the GGUF repo to its `base_model`), and `enable_thinking` is set because the chat template supports it.

## Benchmark results

<!-- BENCH-RESULTS -->

Raw results, per-trial logs and Markdown reports: [`examples/bench/`](examples/bench/). Reproduce with the commands in each report.

## What makes it different

| | typical harness | ah |
|---|---|---|
| Local runtime setup | hand-written base URL per runtime | port scan + API fingerprint; `ah doctor` |
| Ollama context | server default (4k-32k by VRAM), silent front truncation | explicit `num_ctx` from GGUF KV geometry and free memory; stable per model to avoid reloads; truncation detector forces compaction |
| Tool calls as text | lost (model "answers" instead of acting) | recovered from 12 formats; text protocol for models without tool support |
| Server quirks (`max_tokens`, effort values, template errors) | fail | learned from the error, persisted per model |
| Telemetry | tokens, maybe cost | + TTFT, prefill/decode tok/s, KV reuse, load time, GPU util, memory, energy per turn; OTLP |
| Benchmarks | none, or external | built in, sandboxed, hidden graders, pass@k/pass^k/Wilson, ablation, throughput |
| Media | none | image generation + procedural 3D modelling as agent tools |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Runtimes, providers and models](docs/RUNTIMES.md)
- [Benchmarking](docs/BENCHMARKING.md)
- [Telemetry](docs/TELEMETRY.md)
- [Image generation and 3D](docs/MEDIA.md)
- [Security model](docs/SECURITY.md)
- [Configuration](docs/CONFIG.md)
- [Design decisions](docs/DECISIONS.md)
- [Research: local LLM harnesses](docs/RESEARCH-LOCAL.md) · [Research: APIs and prior art](docs/RESEARCH.md)
- [Roadmap](docs/ROADMAP.md)

## Development

```bash
bun test            # unit + integration tests (no network, no models needed)
bun run typecheck
bun run bench:offline   # the suite against scripted reference solutions
```

License: MIT.
