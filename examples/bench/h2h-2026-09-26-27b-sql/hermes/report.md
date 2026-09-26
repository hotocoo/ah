# Benchmark: `external/hermes`

- Run: `bench_2026-09-26T04-56-42_external_hermes` · 2026-09-26T04:56:42.536Z → 2026-09-26T06:56:43.058Z
- ah 0.1.0 @ 419c871 · 2 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads

## Overall

| metric | value |
|---|---|
| trials passed | 0/2 (0%, 95% CI 0%–66%) |
| mean pass@1 | 0% |
| mean pass@2 | 0% |
| mean pass^2 (all trials pass) | 0% |
| tasks solved at least once | 0/1 |
| mean partial score | 6% |
| tasks solved every trial | 0/1 |
| wall time p50 / p95 per trial | 3600.1s / 3600.1s |
| mean TTFT | - |
| mean prefill / decode | - / - tok/s |
| tokens in / out | 1936276 / 65078 |
| tool error rate | 0% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^2 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-sql-engine | typescript | 5 | 0/2 | 0% | 0% | 0%–66% | 3600.1s | 20.5 | 0.0 | - | timeout×2 |

## Failed trials

### ts-sql-engine #1 — timeout

```
FAIL import: Export named 'TokenType' not found in module '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-Tf52n1/ts-sql-engine/src/tokenizer.ts'.
AH_SCORE 0 1
```

### ts-sql-engine #2 — timeout

```
FAIL update sets several columns: no such column: age
FAIL update sees the old row: no such column: id
FAIL delete with where: no such column: amount
FAIL insert with columns and quotes: no such column: id
FAIL delete everything: {} is not iterable
FAIL error: SELECT nope FROM users: message "{} is not iterable" does not match /no such column/
FAIL error: SELECT missing FROM empty_t: message "{} is not iterable" does not match /no such column/
FAIL error: SELECT id FROM users u JOIN orders o ON u.id = o.user_id: message "no such column: u.id" does not match /ambiguous/
FAIL scale: SELECT g, count(*), sum(n) FROM nums WHERE n % 3 = 0 GROUP BY g ORDER BY g: {} is not iterable
FAIL scale: SELECT n, s FROM nums ORDER BY s DESC, n LIMIT 5: {} is not iterable
FAIL scale: SELECT label, count(*) FROM nums JOIN groups ON nums.g = groups.g WHERE n > 2500 GROUP BY label ORDER BY label: {} is not iterable
AH_SCORE 7 61
```

