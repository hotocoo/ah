# Benchmark: `llamacpp/DavidAU/LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF:Q8_0`

- Run: `bench_2026-09-25T19-23-18_llamacpp_DavidAU_LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF_Q8_` · 2026-09-25T19:23:18.425Z → 2026-09-25T22:41:35.457Z
- ah 0.1.0 @ 9700548 · 5 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":0.1,"topK":50,"templateKwargs":{"enable_thinking":true}} (from model card LiquidAI/LFM2.5-2.6B) · context 131072 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 24/40 (60%, 95% CI 45%–74%) |
| mean pass@1 | 60% |
| mean pass@5 | 75% |
| mean pass^5 (all trials pass) | 38% |
| tasks solved at least once | 6/8 |
| mean partial score | 100% |
| harness verdict agrees with grader | 35/40 |
| tasks solved every trial | 3/8 |
| wall time p50 / p95 per trial | 189.9s / 900.0s |
| mean TTFT | 1.1s |
| mean prefill / decode | 1825.7 / 117.8 tok/s |
| tokens in / out | 14497215 / 1242453 |
| tool error rate | 28% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^5 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 4/5 | 80% | 0% | 38%–96% | 132.8s | 22.0 | 5.6 | 121.5 | grader×1 |
| go-feature-stack | go | 2 | 0/5 | 0% | 0% | 0%–43% | 596.8s | 77.4 | 27.8 | 113.6 | timeout×4 grader×1 |
| py-bugfix-duration | python | 2 | 5/5 | 100% | 100% | 57%–100% | 129.8s | 17.8 | 3.6 | 120.6 | - |
| rust-fix-compile-and-logic | rust | 3 | 1/5 | 20% | 0% | 4%–62% | 464.2s | 43.6 | 13.4 | 117.3 | grader×3 timeout×1 |
| ts-debug-cross-file | typescript | 3 | 5/5 | 100% | 100% | 57%–100% | 40.3s | 8.6 | 1.0 | 118.5 | - |
| ts-feature-lru | typescript | 3 | 0/5 | 0% | 0% | 0%–43% | 687.9s | 42.2 | 11.6 | 112.2 | timeout×3 grader×2 |
| ts-multifile-rename | typescript | 3 | 5/5 | 100% | 100% | 57%–100% | 98.9s | 19.0 | 4.8 | 119.3 | - |
| ts-write-tests | typescript | 4 | 4/5 | 80% | 0% | 38%–96% | 215.2s | 21.8 | 9.2 | 119.3 | timeout×1 |

## Failed trials

### ts-bugfix-pagination #2 — grader

```
+   "totalPages": 0,
  }

- Expected  - 1
+ Received  + 1

(fail) empty input has one page [0.11ms]

 7 pass
 1 fail
 16 expect() calls
Ran 8 tests across 2 files. [3.00ms]
```

### go-feature-stack #1 — timeout: aborted

```
FAIL	example.com/stack [setup failed]
FAIL

# example.com/stack
stack_test.go:51:19: expected ']', found '}'
```

### go-feature-stack #2 — timeout: aborted

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:54:5: syntax error: unexpected keyword default, expected expression
./stack.go:55:9: syntax error: unexpected keyword return, expected :
```

### go-feature-stack #3 — grader

```
FAIL	./... [setup failed]
FAIL

# ./...
pattern ./...: directory prefix . does not contain main module or its selected dependencies
```

### go-feature-stack #4 — timeout: aborted

```
# example.com/stack [example.com/stack.test]
./stack.go:20:10: cannot use 0 (untyped int constant) as T value in return statement
./stack.go:29:10: cannot use 0 (untyped int constant) as T value in return statement
./stack_test.go:11:9: invalid argument: stack (variable of type *Stack[int]) for built-in len
./stack_test.go:12:45: invalid argument: stack (variable of type *Stack[int]) for built-in len
./stack_test.go:23:9: invalid argument: stack (variable of type *Stack[int]) for built-in len
./stack_test.go:24:56: invalid argument: stack (variable of type *Stack[int]) for built-in len
./stack_test.go:35:9: invalid argument: stack (variable of type *Stack[int]) for built-in len
./stack_test.go:36:57: invalid argument: stack (variable of type *Stack[int]) for built-in len
./stack_test.go:41:18: int{} is not a type
./stack_test.go:41:18: invalid composite literal type int
./stack_test.go:41:18: too many errors
```

### go-feature-stack #5 — timeout: aborted

```
FAIL	example.com/stack [setup failed]
FAIL

# example.com/stack
stack_test.go:6:19: expected ']', found '}'
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

### rust-fix-compile-and-logic #2 — timeout: aborted

```
assertion `left == right` failed
  left: [("cat", 1), ("cat.", 1)]
 right: [("the", 3), ("cat", 2)]
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    tests::counts_and_orders

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

error: test failed, to rerun pass `--lib`
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

### rust-fix-compile-and-logic #4 — grader

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

### ts-feature-lru #1 — timeout: aborted

```
  ]

- Expected  - 2
+ Received  + 0

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-NNgxbX/ts-feature-lru/src/lru.test.ts:142:26)
(fail) LRUCache > LRU behavior with multiple updates [0.04ms]

 8 pass
 10 fail
 33 expect() calls
Ran 18 tests across 2 files. [4.00ms]
```

### ts-feature-lru #2 — grader

```
  ]

- Expected  - 2
+ Received  + 1

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-TtfZfd/ts-feature-lru/src/lru.test.ts:90:26)
(fail) LRUCache > keys returns keys from least to most recently used [0.04ms]

 12 pass
 6 fail
 28 expect() calls
Ran 18 tests across 2 files. [4.00ms]
```

### ts-feature-lru #3 — timeout: aborted

```
-   [
-     "a",
-     1,
-   ],
- ]
+ []

- Expected  - 6
+ Received  + 1

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-m2T8G6/ts-feature-lru/hidden/lru.hidden.test.ts:22:14)
(fail) onEvict [0.04ms]
```

### ts-feature-lru #4 — grader

```

src/lru.test.ts:

# Unhandled error between tests
-------------------------------
-------------------------------


 0 pass
 2 fail
 2 errors
Ran 2 tests across 2 files. [3.00ms]
```

### ts-feature-lru #5 — timeout: aborted

```
                                  ^
error: expect(received).toHaveBeenCalledWith(...expected)

Expected: [ 1, "val" ]
But it was not called.
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-pKPzfp/ts-feature-lru/src/lru.test.ts:114:29)
(fail) LRUCache > onEvict > should be called on each eviction via callback [0.06ms]

 7 pass
 13 fail
 22 expect() calls
Ran 20 tests across 2 files. [4.00ms]
```

### ts-write-tests #1 — timeout: aborted

```
error: expect(received).toBe(expected)

Expected: "123-hello"
Received: "123hello"

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-pCtzmf/ts-write-tests/src/slugify.test.ts:75:33)
(fail) slugify > numbers at boundaries [0.03ms]

 7 pass
 4 fail
 25 expect() calls
Ran 11 tests across 1 file. [4.00ms]
```

