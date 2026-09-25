# Benchmark: `llamacpp/DavidAU/LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF:Q8_0`

- Run: `bench_2026-09-25T12-45-12_llamacpp_DavidAU_LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF_Q8_` · 2026-09-25T12:45:12.745Z → 2026-09-25T14:38:16.296Z
- ah 0.1.0 @ 0eb3f99 · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":0.1,"topK":50,"templateKwargs":{"enable_thinking":true}} (from model card LiquidAI/LFM2.5-2.6B) · context 131072 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 12/24 (50%, 95% CI 31%–69%) |
| mean pass@1 | 50% |
| mean pass@3 | 63% |
| mean pass^3 (all trials pass) | 38% |
| tasks solved at least once | 5/8 |
| mean partial score | 100% |
| harness verdict agrees with grader | 18/23 |
| tasks solved every trial | 3/8 |
| wall time p50 / p95 per trial | 140.2s / 900.0s |
| mean TTFT | 1.1s |
| mean prefill / decode | 1778.4 / 99.2 tok/s |
| tokens in / out | 3843356 / 571967 |
| tool error rate | 24% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 2/3 | 67% | 0% | 21%–94% | 131.4s | 19.0 | 4.3 | 117.6 | grader×1 |
| go-feature-stack | go | 2 | 0/3 | 0% | 0% | 0%–56% | 248.1s | 18.0 | 6.0 | 117.1 | agent_error×2 timeout×1 |
| py-bugfix-duration | python | 2 | 3/3 | 100% | 100% | 44%–100% | 78.2s | 11.7 | 1.7 | 118.9 | - |
| rust-fix-compile-and-logic | rust | 3 | 0/3 | 0% | 0% | 0%–56% | 437.1s | 27.7 | 7.0 | 111.8 | grader×3 |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 50.7s | 9.3 | 1.0 | 88.9 | - |
| ts-feature-lru | typescript | 3 | 0/3 | 0% | 0% | 0%–56% | 900.0s | 42.3 | 14.3 | 75.0 | timeout×3 |
| ts-multifile-rename | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 74.5s | 14.0 | 3.7 | 79.4 | - |
| ts-write-tests | typescript | 4 | 1/3 | 33% | 0% | 6%–79% | 338.6s | 21.3 | 6.7 | 85.3 | grader×1 timeout×1 |

## Failed trials

### ts-bugfix-pagination #2 — grader

```
error: expect(received).toBe(expected)

Expected: 3
Received: 5

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-VawQkZ/ts-bugfix-pagination/src/paginate.test.ts:30:31)
(fail) paginate > should correctly handle other pages after the fix [0.13ms]

 6 pass
 1 fail
 13 expect() calls
Ran 7 tests across 2 files. [3.00ms]
```

### go-feature-stack #1 — agent_error: llamacpp: tool edit_file arguments are not valid JSON

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack_hidden_test.go:7:8: s.IsEmpty undefined (type Stack[int] has no field or method IsEmpty)
./stack_hidden_test.go:7:23: s.Len undefined (type Stack[int] has no field or method Len)
./stack_hidden_test.go:8:16: s.Pop undefined (type Stack[int] has no field or method Pop)
./stack_hidden_test.go:9:4: s.Push undefined (type Stack[int] has no field or method Push)
./stack_hidden_test.go:10:16: s.Peek undefined (type Stack[int] has no field or method Peek)
./stack_hidden_test.go:11:15: s.Pop undefined (type Stack[int] has no field or method Pop)
./stack_hidden_test.go:12:7: s.Len undefined (type Stack[int] has no field or method Len)
./stack_hidden_test.go:14:16: z.Peek undefined (type Stack[string] has no field or method Peek)
```

### go-feature-stack #2 — timeout: aborted

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:20:28: T (type) is not an expression
./stack.go:29:28: T (type) is not an expression
./stack.go:46:20: undefined: reflect.GoZeroValue
./stack.go:46:33: invalid composite literal type T (no common underlying type)
```

### go-feature-stack #3 — agent_error: llamacpp: tool write_file arguments are not valid JSON

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:4:2: "errors" imported and not used
./stack.go:16:24: undefined: T
./stack.go:17:16: undefined: T
./stack.go:28:23: T (type) is not an expression
./stack.go:38:23: T (type) is not an expression
./stack.go:54:27: undefined: T
./stack.go:55:9: tt declared and not used
```

### rust-fix-compile-and-logic #1 — grader

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

### rust-fix-compile-and-logic #2 — grader

```
assertion `left == right` failed
  left: [("b", 2), ("a", 2), ("c", 1)]
 right: [("a", 2), ("b", 2), ("c", 1)]
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    ties_sorted_alphabetically

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

error: test failed, to rerun pass `--test hidden`
```

### rust-fix-compile-and-logic #3 — grader

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

### ts-feature-lru #1 — timeout: aborted

```
TypeError: undefined is not an object (evaluating 'onEvictCalled.push')
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-u2Z4jf/ts-feature-lru/src/lru.test.ts:125:54)
      at evict (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-u2Z4jf/ts-feature-lru/src/lru.ts:107:18)
      at set (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-u2Z4jf/ts-feature-lru/src/lru.ts:36:14)
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-u2Z4jf/ts-feature-lru/src/lru.test.ts:128:13)
(fail) LRUCache > onEvict > should call onEvict callback with evicted key and value [0.04ms]

 14 pass
 8 fail
 1 error
 28 expect() calls
Ran 22 tests across 3 files. [10.00ms]
```

### ts-feature-lru #2 — timeout: aborted

```

- Expected  - 1
+ Received  + 1

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-XOH6rX/ts-feature-lru/src/lru.test.ts:112:28)
(fail) LRUCache > keys > should reflect recency order after operations [0.04ms]

 8 pass
 6 fail
 1 error
 21 expect() calls
Ran 14 tests across 2 files. [7.00ms]
```

### ts-feature-lru #3 — timeout: aborted

```
error: expect(received).toContain(expected)

Expected to contain: 1
Received: []

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-WQtMhi/ts-feature-lru/src/lru.test.ts:91:25)
(fail) LRUCache > onEvict callback is called on each eviction [0.18ms]

 9 pass
 9 fail
 26 expect() calls
Ran 18 tests across 2 files. [9.00ms]
```

### ts-write-tests #2 — grader

```
src/slugify.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../slugify' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-md0e2l/ts-write-tests/src/slugify.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [6.00ms]
```

### ts-write-tests #3 — timeout: aborted

```
error: expect(received).toBe(expected)

Expected: "japanese"
Received: "-"

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-jnc3Pu/ts-write-tests/src/slugify.test.ts:71:28)
(fail) slugify > should handle unicode letters beyond basic ASCII [0.07ms]

 7 pass
 3 fail
 27 expect() calls
Ran 10 tests across 1 file. [5.00ms]
```

