# Head-to-head, 2026-09-24/25: ah vs Hermes Agent vs DeepSeek Harness (dsh)

Same model for all three: DavidAU/Qwen3.8-27B-TWIN-TURBO (Q6_K GGUF) on one llama-server (`--parallel 1`, runs strictly one after another). Core suite (8 tasks), 3 trials each, fresh sandbox per trial, hidden graders. `bash scripts/h2h.sh --trials 3`.

| harness | trials passed (95% Wilson CI) | wall time p50 / total | model calls p50 | tool calls p50 | prompt tokens, total (per call) |
|---|---|---|---|---|---|
| ah | 24/24 (86%–100%) | 111 s / 53 min | 6.5 | 8 | 0.74M (4,239) |
| dsh 0.1.1-rc.2 | 24/24 (86%–100%) | 221 s / 110 min | 7 | 9 | not recorded by dsh |
| Hermes Agent 0.21.3 | 23/24 (80%–99%) | 246 s / 123 min | 6 | 8 | 2.36M (15,604) |

- **Pass rate: a three-way tie within noise.** The intervals overlap, so no harness is more accurate on this suite. Hermes' one miss was `ts-write-tests` #3.
- **Speed:** ah finished the suite in about half the wall time of either other harness.
- **Context:** ah sent about 3.7× fewer prompt tokens per model call than Hermes (Hermes' figure is uncached + cache-read). dsh's session log has no token counts.
- **How the numbers were collected:**
  - Hermes and dsh counts come from their own session records (`scripts/agent-stats.py`).
  - "Model calls" are LLM requests.
  - Tool-error counts are not comparable: ah counts every non-zero shell exit, Hermes records none, and dsh counts tool results flagged as errors.
- **Setup:**
  - Hermes ran with an isolated `HERMES_HOME`: a custom provider on the same server, no user memory or skills.
  - dsh ran with its headless profile and the user's settings, where the default model is the same server model.
  - ah ran with defaults (memory and extensions are off in bench trials).
- The ah column is from build `43c9a49`. Later fixes (edits of files the model has not read with read_file, the workspace-only shell) are not in these numbers.
