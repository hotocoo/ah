# Benchmark: `llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF`

- Run: `bench_2026-09-24T03-14-23_llamacpp_ggml-org_MiMo-V2.6-Distill-Qwen-9B-GGUF` · 2026-09-24T03:14:23.255Z → 2026-09-24T03:50:47.630Z
- ah 0.1.0 @ 4a83b80 · 2 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":0.6,"topP":0.95,"topK":20,"templateKwargs":{"enable_thinking":true}} (from model card XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B) · context 262144 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 0/2 (0%, 95% CI 0%–66%) |
| mean pass@1 | 0% |
| mean pass@2 | 0% |
| mean pass^2 (all trials pass) | 0% |
| tasks solved at least once | 0/1 |
| mean partial score | 0% |
| tasks solved every trial | 0/1 |
| wall time p50 / p95 per trial | 1092.1s / 1406.8s |
| mean TTFT | 2.3s |
| mean prefill / decode | 725.0 / 45.4 tok/s |
| tokens in / out | 19125 / 95124 |
| tool error rate | 0% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^2 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| py-optimal-scheduler | python | 5 | 0/2 | 0% | 0% | 0%–66% | 1092.1s | 3.5 | 0.0 | 45.4 | max_tokens×2 |

## Failed trials

### py-optimal-scheduler #1 — max_tokens

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

### py-optimal-scheduler #2 — max_tokens

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

