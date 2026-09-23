# Benchmark: `openai-compatible//Users/acotech/.cache/ah/models--mlx-community--MiMo-V2.6-Distill-Qwen-9B-OptiQ-4bit/patched-tool-parser`

- Run: `bench_2026-09-23T09-12-19_openai-compatible_Users_acotech_.cache_ah_models--mlx-community--MiMo-V2.6-Disti` · 2026-09-23T09:12:19.337Z → 2026-09-23T10:08:27.472Z
- ah 0.1.0 @ 1efa250 · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: openai-compatible  (http://127.0.0.1:8092)
- Generation: {"temperature":0.6,"topP":0.95,"topK":20,"templateKwargs":{"enable_thinking":true}} (from model card mlx-community/MiMo-V2.6-Distill-Qwen-9B-OptiQ-4bit) · context 262144 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 14/24 (58%, 95% CI 39%–76%) |
| mean pass@1 | 58% |
| mean pass@3 | 63% |
| mean pass^3 (all trials pass) | 50% |
| tasks solved at least once | 5/8 |
| tasks solved every trial | 4/8 |
| wall time p50 / p95 per trial | 48.5s / 426.6s |
| mean TTFT | 3.0s |
| mean prefill / decode | - / 64.5 tok/s |
| tokens in / out | 1387421 / 73436 |
| tool error rate | 16% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 3/3 | 100% | 100% | 44%–100% | 34.4s | 9.3 | 2.0 | 59.0 | - |
| go-feature-stack | go | 2 | 0/3 | 0% | 0% | 0%–56% | 126.7s | 15.0 | 5.7 | 61.2 | max_turns×3 |
| py-bugfix-duration | python | 2 | 3/3 | 100% | 100% | 44%–100% | 24.6s | 8.3 | 1.0 | 58.6 | - |
| rust-fix-compile-and-logic | rust | 3 | 2/3 | 67% | 0% | 21%–94% | 88.9s | 13.0 | 1.3 | 60.2 | max_turns×1 |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 105.7s | 8.3 | 0.7 | 61.1 | - |
| ts-feature-lru | typescript | 3 | 0/3 | 0% | 0% | 0%–56% | 377.5s | 20.0 | 4.3 | 64.8 | max_turns×3 |
| ts-multifile-rename | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 19.7s | 5.0 | 0.0 | 90.6 | - |
| ts-write-tests | typescript | 4 | 0/3 | 0% | 0% | 0%–56% | 343.1s | 3.3 | 1.7 | 58.4 | timeout×1 agent_error×2 |

## Failed trials

### go-feature-stack #1 — max_turns

```
--- FAIL: TestStackInt (0.00s)
    stack_test.go:44: stack should be empty after popping all items
FAIL
FAIL	example.com/stack	0.013s
FAIL
```

### go-feature-stack #2 — max_turns

```
FAIL	example.com/stack [setup failed]
FAIL

# example.com/stack
stack_test.go:124:6: expected '(', found TestMixedValues
```

### go-feature-stack #3 — max_turns

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack_test.go:50:8: no new variables on left side of :=
./stack_test.go:153:40: invalid slice indices: 0 < 3
```

### rust-fix-compile-and-logic #3 — max_turns

```
assertion `left == right` failed
  left: [("dog", 1), ("end", 1)]
 right: [("the", 3), ("cat", 2)]
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    tests::counts_and_orders

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

error: test failed, to rerun pass `--lib`
```

### ts-feature-lru #1 — max_turns

```
          ^
TypeError: null is not an object (evaluating 'prev.next = next')
      at remove (/Users/acotech/workspace/ah/examples/bench/2026-09-23/mlx-mimo-v2.6-distill-qwen-9b-optiq-4bit/work/ts-feature-lru/1/src/lru.ts:141:5)
      at evict (/Users/acotech/workspace/ah/examples/bench/2026-09-23/mlx-mimo-v2.6-distill-qwen-9b-optiq-4bit/work/ts-feature-lru/1/src/lru.ts:120:10)
      at set (/Users/acotech/workspace/ah/examples/bench/2026-09-23/mlx-mimo-v2.6-distill-qwen-9b-optiq-4bit/work/ts-feature-lru/1/src/lru.ts:76:12)
      at <anonymous> (/Users/acotech/workspace/ah/examples/bench/2026-09-23/mlx-mimo-v2.6-distill-qwen-9b-optiq-4bit/work/ts-feature-lru/1/src/lru.test.ts:219:13)
(fail) LRUCache O(1) behaviour > many operations stay fast [0.68ms]

 5 pass
 22 fail
 28 expect() calls
Ran 27 tests across 2 files. [9.00ms]
```

### ts-feature-lru #2 — max_turns

```
  ]

- Expected  - 2
+ Received  + 1

      at <anonymous> (/Users/acotech/workspace/ah/examples/bench/2026-09-23/mlx-mimo-v2.6-distill-qwen-9b-optiq-4bit/work/ts-feature-lru/2/src/lru.test.ts:233:26)
(fail) LRUCache edge cases > works with non-string keys [0.06ms]

 7 pass
 22 fail
 48 expect() calls
Ran 29 tests across 2 files. [10.00ms]
```

### ts-feature-lru #3 — max_turns

```
                                                                          ^
error: undefined
  expected: undefined
    actual:   1
      at expect (/Users/acotech/workspace/ah/examples/bench/2026-09-23/mlx-mimo-v2.6-distill-qwen-9b-optiq-4bit/work/ts-feature-lru/3/src/lru.test.ts:9:71)
      at <anonymous> (/Users/acotech/workspace/ah/examples/bench/2026-09-23/mlx-mimo-v2.6-distill-qwen-9b-optiq-4bit/work/ts-feature-lru/3/src/lru.test.ts:203:5)
(fail) LRUCache > reorders after a miss, not just a hit [0.08ms]

 1 pass
 21 fail
 9 expect() calls
Ran 22 tests across 2 files. [6.00ms]
```

### ts-write-tests #1 — timeout: aborted

```
bun test v1.4.0 (34cbb9a40)

The following filters did not match any test files in --cwd="/Users/acotech/workspace/ah/examples/bench/2026-09-23/mlx-mimo-v2.6-distill-qwen-9b-optiq-4bit/work/ts-write-tests/1":
 src/slugify.test.ts
10 files were searched [1.00ms]

note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename (ex: "MyApp.test.ts")
note: To treat the "src/slugify.test.ts" filter as a path, run "bun test ./src/slugify.test.ts"
```

### ts-write-tests #2 — agent_error: Unable to connect. Is the computer able to access the url?

```
bun test v1.4.0 (34cbb9a40)

The following filters did not match any test files in --cwd="/Users/acotech/workspace/ah/examples/bench/2026-09-23/mlx-mimo-v2.6-distill-qwen-9b-optiq-4bit/work/ts-write-tests/2":
 src/slugify.test.ts
10 files were searched [2.00ms]

note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename (ex: "MyApp.test.ts")
note: To treat the "src/slugify.test.ts" filter as a path, run "bun test ./src/slugify.test.ts"
```

### ts-write-tests #3 — agent_error: Unable to connect. Is the computer able to access the url?

```
bun test v1.4.0 (34cbb9a40)

The following filters did not match any test files in --cwd="/Users/acotech/workspace/ah/examples/bench/2026-09-23/mlx-mimo-v2.6-distill-qwen-9b-optiq-4bit/work/ts-write-tests/3":
 src/slugify.test.ts
10 files were searched [1.00ms]

note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename (ex: "MyApp.test.ts")
note: To treat the "src/slugify.test.ts" filter as a path, run "bun test ./src/slugify.test.ts"
```

