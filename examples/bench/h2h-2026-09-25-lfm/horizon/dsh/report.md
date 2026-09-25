# Benchmark: `external/dsh`

- Run: `bench_2026-09-25T12-18-06_external_dsh` · 2026-09-25T12:18:06.312Z → 2026-09-25T12:30:40.861Z
- ah 0.1.0 @ ac30c5f · 2 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads

## Overall

| metric | value |
|---|---|
| trials passed | 0/4 (0%, 95% CI 0%–49%) |
| mean pass@1 | 0% |
| mean pass@2 | 0% |
| mean pass^2 (all trials pass) | 0% |
| tasks solved at least once | 0/2 |
| mean partial score | 0% |
| tasks solved every trial | 0/2 |
| wall time p50 / p95 per trial | 161.8s / 351.1s |
| mean TTFT | - |
| mean prefill / decode | - / - tok/s |
| tokens in / out | 0 / 0 |
| tool error rate | 30% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^2 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| py-optimal-scheduler | python | 5 | 0/2 | 0% | 0% | 0%–66% | 161.8s | 18.0 | 8.0 | - | grader×2 |
| ts-sql-engine | typescript | 5 | 0/2 | 0% | 0% | 0%–66% | 215.1s | 7.5 | 2.0 | - | agent_error×2 |

## Failed trials

### py-optimal-scheduler #1 — grader

```
FAIL case 18: NotImplementedError: 
FAIL case 19: NotImplementedError: 
FAIL case 20: NotImplementedError: 
FAIL case 21: NotImplementedError: 
FAIL case 22: NotImplementedError: 
FAIL case 23: NotImplementedError: 
FAIL case 24: NotImplementedError: 
FAIL cycle: NotImplementedError: 
FAIL unknown dep: NotImplementedError: 
FAIL zero workers: NotImplementedError: 
FAIL bad duration: NotImplementedError: 
AH_SCORE 0 29
```

### py-optimal-scheduler #2 — grader

```
FAIL case 18: NotImplementedError: 
FAIL case 19: NotImplementedError: 
FAIL case 20: NotImplementedError: 
FAIL case 21: NotImplementedError: 
FAIL case 22: NotImplementedError: 
FAIL case 23: NotImplementedError: 
FAIL case 24: NotImplementedError: 
FAIL cycle: NotImplementedError: 
FAIL unknown dep: NotImplementedError: 
FAIL zero workers: NotImplementedError: 
FAIL bad duration: NotImplementedError: 
AH_SCORE 0 29
```

### ts-sql-engine #1 — agent_error: exit 1: 

```
FAIL error: SELECT nope FROM users: this.tokenize is not a function. (In 'this.tokenize(columnsPart)', 'this.tokenize' is undefined)
FAIL error: SELECT missing FROM empty_t: this.tokenize is not a function. (In 'this.tokenize(columnsPart)', 'this.tokenize' is undefined)
FAIL error: CREATE TABLE users (x INTEGER): this.tokenize is not a function. (In 'this.tokenize(columnsPart)', 'this.tokenize' is undefined)
FAIL error: SELECT FROM users: this.tokenize is not a function. (In 'this.tokenize(columnsPart)', 'this.tokenize' is undefined)
FAIL error: SELECT * FROM users WHERE: this.tokenize is not a function. (In 'this.tokenize(columnsPart)', 'this.tokenize' is undefined)
FAIL error: INSERT INTO users VALUES (1, 'x'): this.tokenize is not a function. (In 'this.tokenize(columnsPart)', 'this.tokenize' is undefined)
FAIL error: SELECT id FROM users u JOIN orders o ON u.id = o.user_id: this.tokenize is not a function. (In 'this.tokenize(columnsPart)', 'this.tokenize' is undefined)
FAIL scale: insert 5,000 rows: this.tokenize is not a function. (In 'this.tokenize(columnsPart)', 'this.tokenize' is undefined)
FAIL scale: SELECT g, count(*), sum(n) FROM nums WHERE n % 3 = 0 GROUP BY g ORDER BY g: setup failed
FAIL scale: SELECT n, s FROM nums ORDER BY s DESC, n LIMIT 5: setup failed
FAIL scale: SELECT label, count(*) FROM nums JOIN groups ON nums.g = groups.g WHERE n > 2500 GROUP BY label ORDER BY label: setup failed
AH_SCORE 0 61
```

### ts-sql-engine #2 — agent_error: exit 1: dsh: PI_AI_ERROR: The model produced output that does not match the expected peg-native format

```
FAIL error: SELECT nope FROM users: not implemented: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL error: SELECT missing FROM empty_t: not implemented: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL error: CREATE TABLE users (x INTEGER): not implemented: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL error: SELECT FROM users: not implemented: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL error: SELECT * FROM users WHERE: not implemented: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL error: INSERT INTO users VALUES (1, 'x'): not implemented: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL error: SELECT id FROM users u JOIN orders o ON u.id = o.user_id: not implemented: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL scale: insert 5,000 rows: not implemented: CREATE TABLE nums (n INTEGER, g INTEGER, s TEXT)
FAIL scale: SELECT g, count(*), sum(n) FROM nums WHERE n % 3 = 0 GROUP BY g ORDER BY g: setup failed
FAIL scale: SELECT n, s FROM nums ORDER BY s DESC, n LIMIT 5: setup failed
FAIL scale: SELECT label, count(*) FROM nums JOIN groups ON nums.g = groups.g WHERE n > 2500 GROUP BY label ORDER BY label: setup failed
AH_SCORE 0 61
```

