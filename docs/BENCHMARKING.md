# Benchmarking

`ah` ships two benchmarks: an **agentic coding suite** (can the harness + model finish real tasks?) and a **serving throughput** benchmark (how fast is the model through the API the agent uses?). Results go to JSON + Markdown and to the telemetry database, and show up in the web app's Benchmarks tab.

## Agentic suite

```bash
ah bench list
ah bench run --model llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF --trials 3            # all tasks
ah bench run --model llamacpp/<model> --task ts-feature-lru --trials 5
ah bench run --model mock/scripted --trials 1              # reference solutions (plumbing check)
ah bench run --model llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF --baseline            # ah's local adaptations switched off
ah bench compare base/results.json cand/results.json       # per-task deltas, Wilson significance
```

### Task format

`bench/suites/<suite>/<task>/`:

```
task.json      id, name, category, difficulty (1-5), language, prompt, grader {cmd, timeoutMs},
               limits {maxTurns, timeoutMs, maxCostUsd?}, tags, setup?, mockScript
fixture/       the repository the agent starts from
hidden/        copied in only after the agent finishes (hidden tests, grader scripts, mutants)
```

Each trial: fresh copy of `fixture/` → `git init` + commit → optional `setup` → agent runs confined to the copy (`auto` permissions, task turn and time limits) → `git diff --stat` captured → `hidden/` copied in → grader command; **exit 0 = pass**. Hidden graders mean the agent cannot read or edit the tests that judge it. The test suite verifies that every grader **fails** on the untouched fixture and **passes** with the task's reference solution (`mockScript`), so a task can neither pass trivially nor be unsolvable.

### Core suite

| task | lang | category | difficulty | what is graded |
|---|---|---|---|---|
| `ts-bugfix-pagination` | TS | bugfix | 1 | hidden tests for 1-based pagination |
| `go-feature-stack` | Go | feature | 2 | hidden `go test` for a generic stack |
| `py-bugfix-duration` | Python | bugfix | 2 | hidden pytest over mixed-unit durations |
| `rust-fix-compile-and-logic` | Rust | bugfix | 3 | crate must compile; hidden integration tests |
| `ts-debug-cross-file` | TS | debugging | 3 | failing test's root cause is in another module; tests must be unchanged |
| `ts-feature-lru` | TS | feature | 3 | LRU cache from a written spec; hidden behavioural tests |
| `ts-multifile-rename` | TS | refactor | 3 | rename across 4 files; tests pass and old name gone |
| `ts-write-tests` | TS | test-writing | 4 | agent's tests must pass and kill ≥4 of 5 hidden mutants |

Tasks needing a missing toolchain (`go`, `cargo`, `python3`) are skipped and listed as skipped.

### Metrics

Per task and overall: pass count, **pass@1** and **pass@k** (unbiased estimator, Chen et al. 2021), **pass^k** (all k trials pass; Yao et al. 2024), **Wilson 95% interval**, wall time (mean/p50/p95), turns, tool errors, tool calls recovered from text, tokens, TTFT, prefill/decode tokens/s (runtime-reported), GPU utilisation and energy when measurable, failure reasons (`grader`, `timeout`, `agent_error`, `max_turns`, ...). `ah bench compare` reports a change as better/worse only when the Wilson intervals do not overlap.

### Ablation

`--baseline` turns off every local-model adaptation: explicit memory-aware context sizing (runtime default context, no compaction), text tool-call recovery, the compact tool profile, project facts in the prompt (languages, test command, installed toolchains), indentation-tolerant edits, and recoveries (repetition guard, empty-turn nudges, dropped-tool-call fallback); tool calls are native only. What remains is a plain tool loop with the same tools and prompt. Individual switches: `--no-context-sizing`, `--no-text-tools`, `--no-compact`, `--protocol native|text`. Run the same model with and without to measure what the harness itself contributes.

## Throughput

```bash
ah bench throughput --model llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF --sizes 512,2048,8192 --gen 128 --trials 3
```

For each prompt size: TTFT p50/p95, prefill tok/s and decode tok/s (mean ± sd). Runtime-reported timings are used when available (llama.cpp `timings`, Ollama durations), otherwise tokens over measured time. A random nonce at the start of every prompt defeats KV-cache reuse. The benchmark reuses the agent's context decision so Ollama does not reload the model between modes.

## Caveats for interpreting results

- Local wall times include queueing when the runtime is shared with other clients (llama.cpp with one slot serialises requests). Server-side prefill/decode rates are not affected by queueing.
- Small `n` gives wide intervals. Three trials distinguish "always", "sometimes" and "never", not small percentage differences.
- The mock reference run proves the harness and graders work; it says nothing about model quality.
