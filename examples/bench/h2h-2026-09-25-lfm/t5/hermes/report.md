# Benchmark: `external/hermes`

- Run: `bench_2026-09-25T22-41-41_external_hermes` · 2026-09-25T22:41:41.431Z → 2026-09-26T01:36:44.654Z
- ah 0.1.0 @ 9700548 · 5 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads

## Overall

| metric | value |
|---|---|
| trials passed | 10/40 (25%, 95% CI 14%–40%) |
| mean pass@1 | 25% |
| mean pass@5 | 50% |
| mean pass^5 (all trials pass) | 0% |
| tasks solved at least once | 4/8 |
| mean partial score | 100% |
| tasks solved every trial | 0/8 |
| wall time p50 / p95 per trial | 226.7s / 600.0s |
| mean TTFT | - |
| mean prefill / decode | - / - tok/s |
| tokens in / out | 20465349 / 947444 |
| tool error rate | 0% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^5 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 0/5 | 0% | 0% | 0%–43% | 159.1s | 23.6 | 0.0 | - | grader×5 |
| go-feature-stack | go | 2 | 0/5 | 0% | 0% | 0%–43% | 438.4s | 43.2 | 0.0 | - | grader×3 timeout×2 |
| py-bugfix-duration | python | 2 | 3/5 | 60% | 0% | 23%–88% | 125.0s | 14.6 | 0.0 | - | grader×2 |
| rust-fix-compile-and-logic | rust | 3 | 1/5 | 20% | 0% | 4%–62% | 483.5s | 28.8 | 0.0 | - | grader×4 |
| ts-debug-cross-file | typescript | 3 | 4/5 | 80% | 0% | 38%–96% | 100.6s | 10.4 | 0.0 | - | grader×1 |
| ts-feature-lru | typescript | 3 | 0/5 | 0% | 0% | 0%–43% | 356.3s | 33.4 | 0.0 | - | grader×5 |
| ts-multifile-rename | typescript | 3 | 2/5 | 40% | 0% | 12%–77% | 232.4s | 18.0 | 0.0 | - | grader×3 |
| ts-write-tests | typescript | 4 | 0/5 | 0% | 0% | 0%–43% | 199.5s | 18.4 | 0.0 | - | grader×5 |

## Failed trials

### ts-bugfix-pagination #1 — grader

```
37 |     const exactFit = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })));
                                                                               ^
error: Expected ";" but found ")"
    at /private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-UsubcL/ts-bugfix-pagination/src/paginate.test.ts:37:75
-------------------------------


 4 pass
 1 fail
 1 error
 4 expect() calls
Ran 5 tests across 2 files. [3.00ms]
```

### ts-bugfix-pagination #2 — grader

```
- ]
+ []

- Expected  - 3
+ Received  + 1

(fail) last partial page [0.02ms]

 2 pass
 2 fail
 4 expect() calls
Ran 4 tests across 1 file. [3.00ms]
```

### ts-bugfix-pagination #3 — grader

```
error: expect(received).toBe(expected)

Expected: 0
Received: 1

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-QYe6Xx/ts-bugfix-pagination/src/paginate.test.ts:34:31)
(fail) paginate > should handle empty items array [0.12ms]

 7 pass
 1 fail
 16 expect() calls
Ran 8 tests across 2 files. [3.00ms]
```

### ts-bugfix-pagination #4 — grader

```
error: expect(received).toBe(expected)

Expected: 0
Received: 1

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-mzd8Jd/ts-bugfix-pagination/src/paginate.test.ts:35:31)
(fail) paginate > should handle empty items array [0.12ms]

 7 pass
 1 fail
 16 expect() calls
Ran 8 tests across 2 files. [4.00ms]
```

### ts-bugfix-pagination #5 — grader

```

# Unhandled error between tests
-------------------------------
error: Cannot find module '../paginate' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-vJcrzL/ts-bugfix-pagination/src/paginate.test.ts'
-------------------------------


 4 pass
 1 fail
 1 error
 4 expect() calls
Ran 5 tests across 2 files. [3.00ms]
```

### go-feature-stack #1 — grader

```
FAIL	example.com/stack [setup failed]
FAIL

# example.com/stack
stack_test.go:73:22: expected ']', found '}'
```

### go-feature-stack #2 — timeout

```
FAIL	./... [setup failed]
FAIL

# ./...
pattern ./...: directory prefix . does not contain main module or its selected dependencies
```

### go-feature-stack #3 — timeout

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:17:24: undefined: T
./stack.go:18:16: undefined: T
./stack.go:25:10: cannot use v (variable of struct type reflect.Value) as T value in return statement
./stack.go:35:10: cannot use v (variable of struct type reflect.Value) as T value in return statement
./stack_hidden_test.go:9:4: s.Push undefined (type Stack[int] has no field or method Push)
```

### go-feature-stack #4 — grader

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:10:24: undefined: T
./stack.go:11:10: cannot use generic type Stack[T any] without instantiation
./stack.go:11:30: undefined: T
```

### go-feature-stack #5 — grader

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:16:26: syntax error: unexpected name any, expected ]
```

### py-bugfix-duration #2 — grader

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
2 failed, 5 passed in 0.01s
```

### py-bugfix-duration #3 — grader

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
2 failed, 5 passed in 0.01s
```

### rust-fix-compile-and-logic #2 — grader

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
error[E0432]: unresolved import `wordfreq`
 --> tests/hidden.rs:1:5
  |
1 | use wordfreq::top_words;
  |     ^^^^^^^^ use of unresolved module or unlinked crate `wordfreq`
  |
  = help: if you wanted to use a crate named `wordfreq`, use `cargo add wordfreq` to add it to your `Cargo.toml`

For more information about this error, try `rustc --explain E0432`.
error: could not compile `wordfreq` (test "hidden") due to 1 previous error
```

### rust-fix-compile-and-logic #5 — grader

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

### ts-debug-cross-file #4 — grader

```
error: expect(received).toBe(expected)

Expected: 2164
Received: 2163

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-QIaeRW/ts-debug-cross-file/tests/checkout.test.ts:7:61)
(fail) rounds tax half-up [0.35ms]

 0 pass
 1 fail
 1 expect() calls
Ran 1 test across 1 file. [5.00ms]
```

### ts-feature-lru #1 — grader

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

### ts-feature-lru #2 — grader

```
Builtins: "bun:test" 

Elapsed: 5ms | User: 3ms | Sys: 4ms
RSS: 16.53 MB | Peak: 16.53 MB | Commit: 44.71 MB | Faults: 46 | Machine: 0.1 TB

panic(main thread): Segmentation fault at address 0x5
oh no: Bun has crashed. This indicates a bug in Bun, not your code.

To send a redacted crash report to Bun's team,
please file a GitHub issue using the link below:

 https://bun.report/1.4.0/Mt134cbb9aAggggCmzmsWu217vB+tx2rBmu44vB21+yoBm+/7sB24t2H+ni2Hu+g2Hm9/1Hum40H+xgDuqxB+mlB__A2AK
```

### ts-feature-lru #3 — grader

```
+ []

- Expected  - 6
+ Received  + 1

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-HrM0fK/ts-feature-lru/hidden/lru.hidden.test.ts:22:14)
(fail) onEvict [0.07ms]

 15 pass
 2 fail
 29 expect() calls
Ran 17 tests across 2 files. [4.00ms]
```

### ts-feature-lru #4 — grader

```
error: expect(received).toHaveBeenCalledWith(...expected)

Expected: [ "a", 1 ]
But it was not called.
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-FHkFGu/ts-feature-lru/src/lru.test.ts:116:24)
(fail) LRUCache > onEvict > should call callback on eviction [0.07ms]

 12 pass
 3 fail
 1 error
 23 expect() calls
Ran 15 tests across 2 files. [4.00ms]
```

### ts-feature-lru #5 — grader

```
src/lru.test.ts:

# Unhandled error between tests
-------------------------------
SyntaxError: Export named 'LRUCache' not found in module '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-9bOimH/ts-feature-lru/src/lru.ts'.
-------------------------------


 0 pass
 2 fail
 2 errors
Ran 2 tests across 2 files. [3.00ms]
```

### ts-multifile-rename #1 — grader

```
src/report.ts:4:  return users.map((u, i) => `${i + 1}. ${getUserName(u)}`).join("\n");
src/greet.ts:1:import { getUserName, type User } from "./user.ts";
src/greet.ts:3:export const greet = (u: User) => `Hello, ${getUserName(u)}!`;
src/user.ts:7:export function getUserName(u: User): string {
tests/user.test.ts:2:import { getUserName } from "../src/user.ts";
tests/user.test.ts:6:test("nick wins", () => expect(getUserName({ first: "A", last: "B", nick: "ab" })).toBe("ab"));


 3 pass
 0 fail
 3 expect() calls
Ran 3 tests across 1 file. [5.00ms]
```

### ts-multifile-rename #2 — grader

```
tests/user.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './user.ts' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-YI5Tu5/ts-multifile-rename/tests/user.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-multifile-rename #4 — grader

```
src/report.ts:4:  return users.map((u, i) => `${i + 1}. ${getUserName(u)}`).join("\n");
src/greet.ts:1:import { getUserName, type User } from "./user.ts";
src/greet.ts:3:export const greet = (u: User) => `Hello, ${getUserName(u)}!`;
src/user.ts:7:export function getUserName(u: User): string {
tests/user.test.ts:2:import { getUserName } from "../src/user.ts";
tests/user.test.ts:6:test("nick wins", () => expect(getUserName({ first: "A", last: "B", nick: "ab" })).toBe("ab"));


 3 pass
 0 fail
 3 expect() calls
Ran 3 tests across 1 file. [3.00ms]
```

### ts-write-tests #1 — grader

```
bun test v1.4.0 (34cbb9a40)

The following filters did not match any test files in --cwd="/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-hHnuy3/ts-write-tests":
 src/slugify.test.ts
11 files were searched [2.00ms]

note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename (ex: "MyApp.test.ts")
note: To treat the "src/slugify.test.ts" filter as a path, run "bun test ./src/slugify.test.ts"
```

### ts-write-tests #2 — grader

```
src/slugify.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../slugify' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-YlGuqx/ts-write-tests/src/slugify.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-write-tests #3 — grader

```
src/slugify.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../slugify' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-ou3irW/ts-write-tests/src/slugify.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-write-tests #4 — grader

```
src/slugify.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../slugify' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-YcWnDg/ts-write-tests/src/slugify.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-write-tests #5 — grader

```
24 |   test("handles punctuation runs", () => {
25 |     expect(slugify("hello!!world!!!")).toBe("hello-world");
26 |     expect(slugify("...hello...").toBe("hello")); // only one separator between words
                                       ^
TypeError: slugify("...hello...").toBe is not a function. (In 'slugify("...hello...").toBe("hello")', 'slugify("...hello...").toBe' is undefined)
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-6HRKrs/ts-write-tests/src/slugify.test.ts:26:35)
(fail) slugify > handles punctuation runs [0.03ms]

 10 pass
 3 fail
 23 expect() calls
Ran 13 tests across 1 file. [3.00ms]
```

