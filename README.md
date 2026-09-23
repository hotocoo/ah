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
Measured on Apple M4 Max, 64 GB unified memory. 8 tasks × 3 trials per model; each trial in a fresh sandbox, graded by hidden tests.

| model · runtime | mode | trials passed (95% CI) | pass@1 | pass^k | tasks solved ≥1× / every trial | turns / trial | tool error rate | wall p50 / trial | decode tok/s |
|---|---|---|---|---|---|---|---|---|---|
| ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF · llamacpp | ah | 20/24 (64%–93%) | 83% | 75% | 7 / 6 of 8 | 10.8 | 21% | 44 s | 45.0 |
| ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF · llamacpp | baseline (ah adaptations off) | 18/24 (55%–88%) | 75% | 75% | 6 / 6 of 8 | 10.4 | 12% | 44 s | 46.5 |
| mlx-community/MiMo-V2.6-Distill-Qwen-9B-OptiQ-4bit (tool-parser field fixed) · openai-compatible | ah | 14/24 (39%–76%) | 58% | 50% | 5 / 4 of 8 | 10.3 | 16% | 49 s | 64.5 |

Per task (passes / trials):

| task | ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF · llamacpp | ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF · llamacpp baseline | mlx-community/MiMo-V2.6-Distill-Qwen-9B-OptiQ-4bit (tool-parser field fixed) · openai-compatible |
|---|---|---|---|
| ts-bugfix-pagination | 3/3 | 3/3 | 3/3 |
| go-feature-stack | 2/3 | 3/3 | 0/3 |
| py-bugfix-duration | 3/3 | 3/3 | 3/3 |
| rust-fix-compile-and-logic | 3/3 | 3/3 | 2/3 |
| ts-debug-cross-file | 3/3 | 3/3 | 3/3 |
| ts-feature-lru | 0/3 | 0/3 | 0/3 |
| ts-multifile-rename | 3/3 | 3/3 | 3/3 |
| ts-write-tests | 3/3 | 0/3 | 0/3 |

Ablation on ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF · llamacpp (A = baseline, B = ah):

| task | A: baseline | B: ah | Δ pass rate | significance (Wilson 95%) |
|---|---|---|---|---|
| go-feature-stack | 3/3 | 2/3 | -33 pts | same |
| py-bugfix-duration | 3/3 | 3/3 | +0 pts | same |
| rust-fix-compile-and-logic | 3/3 | 3/3 | +0 pts | same |
| ts-bugfix-pagination | 3/3 | 3/3 | +0 pts | same |
| ts-debug-cross-file | 3/3 | 3/3 | +0 pts | same |
| ts-feature-lru | 0/3 | 0/3 | +0 pts | same |
| ts-multifile-rename | 3/3 | 3/3 | +0 pts | same |
| ts-write-tests | 0/3 | 3/3 | +100 pts | same |
| overall | 18/24 | 20/24 | +8 pts | same |

Reports: [ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF · llamacpp](examples/bench/2026-09-23/llamacpp-mimo-v2.6-distill-qwen-9b-q8_0/report.md) · [ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF · llamacpp baseline](examples/bench/2026-09-23/llamacpp-mimo-v2.6-distill-qwen-9b-q8_0-baseline/report.md) · [mlx-community/MiMo-V2.6-Distill-Qwen-9B-OptiQ-4bit (tool-parser field fixed) · openai-compatible](examples/bench/2026-09-23/mlx-mimo-v2.6-distill-qwen-9b-optiq-4bit/report.md)
<!-- /BENCH-RESULTS -->

How to read these numbers:

- **Model and serving.** [MiMo-V2.6-Distill-Qwen-9B](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B) (Xiaomi, 2026), served exactly as its cards recommend: `llama serve -hf ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF` (Q8_0) and `optiq serve --model mlx-community/MiMo-V2.6-Distill-Qwen-9B-OptiQ-4bit`. `ah` applied the card's sampling (temperature 0.6, top_p 0.95, top_k 20) and `enable_thinking: true` automatically.
- **Ablation.** Same model and server, with every `ah` local-model adaptation switched off (`--baseline`). `ah` passed 20/24 trials vs 18/24; the difference comes from `ts-write-tests` (3/3 vs 0/3) against `go-feature-stack` (2/3 vs 3/3). With three trials per task the Wilson intervals overlap, so this is **not** a statistically significant difference; turns per trial were similar. Several adaptations exist because of failures seen on other runs (see `docs/DECISIONS.md` D21-D24) and matter most on weaker servers and models.
- **MLX run.** The OptiQ repo's `tokenizer_config.json` names the wrong tool parser, which makes mlx-lm drop every tool call; the run used a local copy with that one field corrected (see `docs/ROADMAP.md`). Two `ts-write-tests` trials were lost when mlx-lm crashed with `[metal::malloc] Resource limit (499000) exceeded` and restarted; `ah` now retries unreachable servers with backoff. A supplementary re-run of that task (after the fix) also scored 0/3 (turn and time limits), so the lost trials did not change the result: [`examples/bench-supplementary/`](examples/bench-supplementary/).
- **4-bit vs 8-bit.** The Q8_0 GGUF on llama.cpp solved more tasks than the OptiQ 4-bit MLX build (7/8 vs 5/8); the MLX server decoded faster (64.5 vs 45.0 tok/s).
- `ts-feature-lru` (implement an LRU cache from a written spec, 20-turn limit) was not solved by any configuration.

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
