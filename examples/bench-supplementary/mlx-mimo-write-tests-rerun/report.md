# Benchmark: `openai-compatible//Users/acotech/.cache/ah/models--mlx-community--MiMo-V2.6-Distill-Qwen-9B-OptiQ-4bit/patched-tool-parser`

- Run: `bench_2026-09-23T10-19-48_openai-compatible_Users_acotech_.cache_ah_models--mlx-community--MiMo-V2.6-Disti` · 2026-09-23T10:19:48.601Z → 2026-09-23T10:42:44.505Z
- ah 0.1.0 @ c754e6b · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: openai-compatible  (http://127.0.0.1:8092)
- Generation: {"temperature":0.6,"topP":0.95,"topK":20,"templateKwargs":{"enable_thinking":true}} (from model card mlx-community/MiMo-V2.6-Distill-Qwen-9B-OptiQ-4bit) · context 262144 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 0/3 (0%, 95% CI 0%–56%) |
| mean pass@1 | 0% |
| mean pass@3 | 0% |
| mean pass^3 (all trials pass) | 0% |
| tasks solved at least once | 0/1 |
| tasks solved every trial | 0/1 |
| wall time p50 / p95 per trial | 587.6s / 598.5s |
| mean TTFT | 3.4s |
| mean prefill / decode | - / 47.2 tok/s |
| tokens in / out | 300626 / 35497 |
| tool error rate | 22% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-write-tests | typescript | 4 | 0/3 | 0% | 0% | 0%–56% | 458.4s | 14.7 | 3.7 | 47.2 | timeout×1 max_turns×2 |

## Failed trials

### ts-write-tests #1 — timeout: aborted

```
error: expect(received).toBe(expected)

Expected: "foobar"
Received: "foo-bar"

      at <anonymous> (/Users/acotech/workspace/ah/examples/bench-supplementary/mlx-mimo-write-tests-rerun/work/ts-write-tests/1/src/slugify.test.ts:396:39)
(fail) slugify > edge cases > handles non-breaking spaces and other Unicode spaces [0.04ms]

 37 pass
 8 fail
 271 expect() calls
Ran 45 tests across 1 file. [6.00ms]
```

### ts-write-tests #2 — max_turns

```
error: expect(received).toBe(expected)

Expected: "omega"
Received: "mega"

      at <anonymous> (/Users/acotech/workspace/ah/examples/bench-supplementary/mlx-mimo-write-tests-rerun/work/ts-write-tests/2/src/slugify.test.ts:114:30)
(fail) slugify > removes non-ASCII characters that survive decomposition [0.06ms]

 13 pass
 2 fail
 119 expect() calls
Ran 15 tests across 1 file. [4.00ms]
```

### ts-write-tests #3 — max_turns

```
error: expect(received).toBe(expected)

Expected: "a-s"
Received: "as"

      at <anonymous> (/Users/acotech/workspace/ah/examples/bench-supplementary/mlx-mimo-write-tests-rerun/work/ts-write-tests/3/src/slugify.test.ts:270:34)
(fail) slugify > unicode letters > keeps letters that do not decompose [0.03ms]

 33 pass
 4 fail
 155 expect() calls
Ran 37 tests across 1 file. [3.00ms]
```

