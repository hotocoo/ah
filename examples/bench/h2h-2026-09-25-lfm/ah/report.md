# Benchmark: `llamacpp/DavidAU/LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF:Q8_0`

- Run: `bench_2026-09-25T05-37-29_llamacpp_DavidAU_LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF_Q8_` · 2026-09-25T05:37:29.733Z → 2026-09-25T06:27:18.119Z
- ah 0.1.0 @ 85cc190 · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":0.1,"topK":50,"templateKwargs":{"enable_thinking":true}} (from model card LiquidAI/LFM2.5-2.6B) · context 65536 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 8/24 (33%, 95% CI 18%–53%) |
| mean pass@1 | 33% |
| mean pass@3 | 50% |
| mean pass^3 (all trials pass) | 13% |
| tasks solved at least once | 4/8 |
| mean partial score | 100% |
| harness verdict agrees with grader | 17/22 |
| tasks solved every trial | 1/8 |
| wall time p50 / p95 per trial | 98.8s / 244.2s |
| mean TTFT | 1.1s |
| mean prefill / decode | 1865.7 / 118.8 tok/s |
| tokens in / out | 1732713 / 327650 |
| tool error rate | 42% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 2/3 | 67% | 0% | 21%–94% | 36.8s | 9.7 | 2.0 | 122.1 | grader×1 |
| go-feature-stack | go | 2 | 0/3 | 0% | 0% | 0%–56% | 78.1s | 11.0 | 2.7 | 119.7 | agent_error×1 max_turns×2 |
| py-bugfix-duration | python | 2 | 2/3 | 67% | 0% | 21%–94% | 57.7s | 10.7 | 4.0 | 119.4 | max_turns×1 |
| rust-fix-compile-and-logic | rust | 3 | 0/3 | 0% | 0% | 0%–56% | 150.3s | 20.0 | 13.0 | 118.5 | max_turns×3 |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 105.1s | 17.0 | 5.7 | 118.1 | - |
| ts-feature-lru | typescript | 3 | 0/3 | 0% | 0% | 0%–56% | 154.8s | 18.0 | 7.7 | 116.9 | grader×2 max_turns×1 |
| ts-multifile-rename | typescript | 3 | 0/3 | 0% | 0% | 0%–56% | 284.5s | 25.0 | 27.0 | 118.1 | max_turns×3 |
| ts-write-tests | typescript | 4 | 1/3 | 33% | 0% | 6%–79% | 127.2s | 15.0 | 8.7 | 117.7 | max_turns×2 |

## Failed trials

### ts-bugfix-pagination #2 — grader

```
+   "totalPages": 0,
  }

- Expected  - 1
+ Received  + 1

(fail) empty input has one page [0.38ms]

 7 pass
 1 fail
 16 expect() calls
Ran 8 tests across 2 files. [3.00ms]
```

### go-feature-stack #1 — agent_error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()

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
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:14:10: cannot use generic type Stack[T any] without instantiation
./stack.go:14:24: undefined: T
./stack.go:18:10: cannot use generic type Stack[T any] without instantiation
./stack.go:18:24: undefined: T
./stack.go:27:10: cannot use generic type Stack[T any] without instantiation
./stack.go:27:25: undefined: T
./stack.go:34:10: cannot use generic type Stack[T any] without instantiation
./stack.go:38:10: cannot use generic type Stack[T any] without instantiation
```

### go-feature-stack #3 — max_turns

```
FAIL	example.com/stack [setup failed]
FAIL

# example.com/stack
stack_test.go:18:18: expected ']', found '}'
```

### py-bugfix-duration #2 — max_turns

```
    def test_values(s, n):
>       assert parse_duration(s) == n
E       AssertionError: assert 3 == 3723
E        +  where 3 = parse_duration('1h2m3s')

test_duration_hidden.py:6: AssertionError
=========================== short test summary info ============================
FAILED test_duration_hidden.py::test_values[1h30m-5400] - AssertionError: assert 1800 == 5400
 +  where 1800 = parse_duration('1h30m')
FAILED test_duration_hidden.py::test_values[1h2m3s-3723] - AssertionError: assert 3 == 3723
 +  where 3 = parse_duration('1h2m3s')
2 failed, 5 passed in 0.02s
```

### rust-fix-compile-and-logic #1 — max_turns

```

error[E0308]: mismatched types
  --> src/lib.rs:20:19
   |
20 |         if cmp != 0 {
   |            ---    ^ expected `Ordering`, found integer
   |            |
   |            expected because this is `std::cmp::Ordering`

For more information about this error, try `rustc --explain E0308`.
error: could not compile `wordfreq` (lib) due to 1 previous error; 1 warning emitted
error: could not compile `wordfreq` (lib test) due to 1 previous error; 1 warning emitted
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
  |
8 |         let word: String = raw.chars().filter(|c| !c.is_ascii_punctuation()).collect().to_lowercase();
  |                                                                              ^^^^^^^ cannot infer type of the type parameter `B` declared on the method `collect`
  |
help: consider specifying the generic argument
  |
8 |         let word: String = raw.chars().filter(|c| !c.is_ascii_punctuation()).collect::<Vec<_>>().to_lowercase();
  |                                                                                     ++++++++++

For more information about this error, try `rustc --explain E0282`.
error: could not compile `wordfreq` (lib) due to 1 previous error
error: could not compile `wordfreq` (lib test) due to 1 previous error
```

### ts-feature-lru #1 — grader

```
Builtins: "bun:test" 

Elapsed: 2ms | User: 3ms | Sys: 3ms
RSS: 14.42 MB | Peak: 14.42 MB | Commit: 39.93 MB | Faults: 44 | Machine: 0.1 TB

panic(main thread): Segmentation fault at address 0x5
oh no: Bun has crashed. This indicates a bug in Bun, not your code.

To send a redacted crash report to Bun's team,
please file a GitHub issue using the link below:

 https://bun.report/1.4.0/Mt134cbb9agCggggCmzmsWu217vB+tx2rBmu44vB21+yoBm+/7sB24t2H+ni2Hu+g2Hm9/1Hum40H+xgDuqxB+mlB__A2AK
```

### ts-feature-lru #2 — max_turns

```
Builtins: "bun:test" 

Elapsed: 3ms | User: 3ms | Sys: 4ms
RSS: 14.53 MB | Peak: 14.53 MB | Commit: 40.12 MB | Faults: 44 | Machine: 0.1 TB

panic(main thread): Segmentation fault at address 0x5
oh no: Bun has crashed. This indicates a bug in Bun, not your code.

To send a redacted crash report to Bun's team,
please file a GitHub issue using the link below:

 https://bun.report/1.4.0/Mt134cbb9agCggggCmzmsWu217vB+tx2rBmu44vB21+yoBm+/7sB24t2H+ni2Hu+g2Hm9/1Hum40H+xgDuqxB+mlB__A2AK
```

### ts-feature-lru #3 — grader

```
                          ^
error: expect(received).toHaveBeenCalledWith(...expected)

Expected: [ "a", 1 ]
But it was not called.
      at <anonymous> (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/ah/work/ts-feature-lru/3/src/lru.test.ts:89:22)
(fail) LRUCache > onEvict callback is called on eviction [0.07ms]

 10 pass
 7 fail
 27 expect() calls
Ran 17 tests across 2 files. [3.00ms]
```

### ts-multifile-rename #1 — max_turns

```
tests/user.test.ts:

# Unhandled error between tests
-------------------------------
SyntaxError: Export named 'getUserName' not found in module '/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/ah/work/ts-multifile-rename/1/src/user.ts'.
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [2.00ms]
```

### ts-multifile-rename #2 — max_turns

```
tests/user.test.ts:

# Unhandled error between tests
-------------------------------
SyntaxError: Export named 'getUserName' not found in module '/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/ah/work/ts-multifile-rename/2/src/user.ts'.
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [2.00ms]
```

### ts-multifile-rename #3 — max_turns

```
tests/user.test.ts:

# Unhandled error between tests
-------------------------------
SyntaxError: Export named 'getUserName' not found in module '/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/ah/work/ts-multifile-rename/3/src/user.ts'.
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [2.00ms]
```

### ts-write-tests #1 — max_turns

```
error: expect(received).toBe(expected)

Expected: "cafe-abe"
Received: "cafeabbe"

      at <anonymous> (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/ah/work/ts-write-tests/1/src/slugify.test.ts:77:33)
(fail) slugify > handles unicode letters that are not accented but have diacritics [0.02ms]

 7 pass
 5 fail
 26 expect() calls
Ran 12 tests across 1 file. [2.00ms]
```

### ts-write-tests #2 — max_turns

```

43 |     expect(slugify("---end").toBe("end");
                                             ^
error: Expected ")" but found ";"
    at /Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/ah/work/ts-write-tests/2/src/slugify.test.ts:43:41
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [1.00ms]
```

