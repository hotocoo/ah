# Benchmark: `llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF`

- Run: `bench_2026-09-24T03-52-26_llamacpp_ggml-org_MiMo-V2.6-Distill-Qwen-9B-GGUF` · 2026-09-24T03:52:26.014Z → 2026-09-24T04:37:26.238Z
- ah 0.1.0 @ 6619a57 · 1 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":0.6,"topP":0.95,"topK":20,"templateKwargs":{"enable_thinking":true}} (from model card XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B) · context 262144 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 0/1 (0%, 95% CI 0%–79%) |
| mean pass@1 | 0% |
| mean pass@1 | 0% |
| mean pass^1 (all trials pass) | 0% |
| tasks solved at least once | 0/1 |
| mean partial score | 0% |
| tasks solved every trial | 0/1 |
| wall time p50 / p95 per trial | 2700.0s / 2700.0s |
| mean TTFT | 1.2s |
| mean prefill / decode | 437.5 / 45.4 tok/s |
| tokens in / out | 13574 / 77711 |
| tool error rate | 0% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^1 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| py-optimal-scheduler | python | 5 | 0/1 | 0% | 0% | 0%–79% | 2700.0s | 6.0 | 0.0 | 45.4 | timeout×1 |

## Failed trials

### py-optimal-scheduler #1 — timeout: aborted

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

