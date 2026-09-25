# Benchmark: `llamacpp/DavidAU/LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF:Q8_0`

- Run: `bench_2026-09-25T08-37-36_llamacpp_DavidAU_LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF_Q8_` · 2026-09-25T08:37:36.094Z → 2026-09-25T09:42:32.024Z
- ah 0.1.0 @ ac30c5f · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":0.1,"topK":50,"templateKwargs":{"enable_thinking":true}} (from model card LiquidAI/LFM2.5-2.6B) · context 131072 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 11/24 (46%, 95% CI 28%–65%) |
| mean pass@1 | 46% |
| mean pass@3 | 50% |
| mean pass^3 (all trials pass) | 38% |
| tasks solved at least once | 4/8 |
| mean partial score | 100% |
| harness verdict agrees with grader | 20/22 |
| tasks solved every trial | 3/8 |
| wall time p50 / p95 per trial | 99.6s / 451.1s |
| mean TTFT | 1.0s |
| mean prefill / decode | 1876.5 / 117.2 tok/s |
| tokens in / out | 1963337 / 413801 |
| tool error rate | 27% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 3/3 | 100% | 100% | 44%–100% | 37.5s | 9.3 | 2.0 | 118.5 | - |
| go-feature-stack | go | 2 | 0/3 | 0% | 0% | 0%–56% | 164.6s | 15.0 | 9.0 | 117.5 | max_turns×3 |
| py-bugfix-duration | python | 2 | 3/3 | 100% | 100% | 44%–100% | 67.0s | 13.0 | 4.3 | 118.1 | - |
| rust-fix-compile-and-logic | rust | 3 | 0/3 | 0% | 0% | 0%–56% | 286.5s | 20.0 | 5.7 | 117.1 | max_turns×3 |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 40.4s | 10.0 | 1.0 | 118.0 | - |
| ts-feature-lru | typescript | 3 | 0/3 | 0% | 0% | 0%–56% | 428.0s | 20.0 | 6.7 | 114.4 | max_turns×3 |
| ts-multifile-rename | typescript | 3 | 2/3 | 67% | 0% | 21%–94% | 94.5s | 18.0 | 6.7 | 117.2 | max_turns×1 |
| ts-write-tests | typescript | 4 | 0/3 | 0% | 0% | 0%–56% | 178.6s | 15.0 | 6.0 | 117.1 | max_turns×3 |

## Failed trials

### go-feature-stack #1 — max_turns

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

### go-feature-stack #2 — max_turns

```
FAIL	example.com/stack [setup failed]
FAIL

# example.com/stack
stack_test.go:25:19: expected ']', found '}'
```

### go-feature-stack #3 — max_turns

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:55:5: syntax error: unexpected keyword default, expected expression
./stack.go:56:9: syntax error: unexpected keyword return, expected :
```

### rust-fix-compile-and-logic #1 — max_turns

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

### rust-fix-compile-and-logic #2 — max_turns

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

### rust-fix-compile-and-logic #3 — max_turns

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

### ts-feature-lru #1 — max_turns

```
+ []

- Expected  - 4
+ Received  + 1

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-VJpPnz/ts-feature-lru/src/lru.test.ts:93:29)
(fail) LRUCache > capacity enforcement evicts LRU when over capacity [0.04ms]

 11 pass
 7 fail
 26 expect() calls
Ran 18 tests across 2 files. [3.00ms]
```

### ts-feature-lru #2 — max_turns

```
      at onEvict (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-ZaJwgr/ts-feature-lru/src/lru.ts:89:14)
      at onEvict (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-ZaJwgr/ts-feature-lru/src/lru.ts:89:14)
      at onEvict (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-ZaJwgr/ts-feature-lru/src/lru.ts:89:14)
      at onEvict (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-ZaJwgr/ts-feature-lru/src/lru.ts:89:14)
      at onEvict (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-ZaJwgr/ts-feature-lru/src/lru.ts:89:14)
      at onEvict (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-ZaJwgr/ts-feature-lru/src/lru.ts:89:14)
(fail) LRUCache > onEvict callback is called during eviction [0.70ms]

 2 pass
 13 fail
 14 expect() calls
Ran 15 tests across 2 files. [8.00ms]
```

### ts-feature-lru #3 — max_turns

```
error: expect(received).toContain(expected)

Expected to contain: "a"
Received: []

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-ODRMZZ/ts-feature-lru/src/lru.test.ts:89:23)
(fail) LRUCache > onEvict is called on eviction [0.04ms]

 6 pass
 8 fail
 28 expect() calls
Ran 14 tests across 2 files. [3.00ms]
```

### ts-multifile-rename #1 — max_turns

```
                                              ^
ReferenceError: getUserName is not defined
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-rl54C3/ts-multifile-rename/src/report.ts:4:43)
      at map (1:11)
      at report (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-rl54C3/ts-multifile-rename/src/report.ts:4:16)
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-rl54C3/ts-multifile-rename/tests/user.test.ts:8:29)
(fail) report [0.10ms]

 1 pass
 2 fail
 1 expect() calls
Ran 3 tests across 1 file. [2.00ms]
```

### ts-write-tests #1 — max_turns

```
error: expect(received).toBe(expected)

Expected: "cafe resume"
Received: "cafe-resume"

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-IShVZZ/ts-write-tests/src/slugify.test.ts:74:36)
(fail) slugify > should handle non-Latin Unicode characters gracefully [0.03ms]

 10 pass
 3 fail
 22 expect() calls
Ran 13 tests across 1 file. [2.00ms]
```

### ts-write-tests #2 — max_turns

```
-------------------------------
39 |       expect(slugify("---test").toBe("test");
                                                 ^
error: Expected ")" but found ";"
    at /private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-RpZ0bY/ts-write-tests/src/slugify.test.ts:39:45
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [1.00ms]
```

### ts-write-tests #3 — max_turns

```
bun test v1.4.0 (34cbb9a40)

The following filters did not match any test files in --cwd="/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-oTgti1/ts-write-tests":
 src/slugify.test.ts
10 files were searched [1.00ms]

note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename (ex: "MyApp.test.ts")
note: To treat the "src/slugify.test.ts" filter as a path, run "bun test ./src/slugify.test.ts"
```

