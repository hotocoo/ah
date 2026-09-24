# Head-to-head, 2026-09-24: ah column, 3 trials

Model: DavidAU/Qwen3.8-27B-TWIN-TURBO (Q6_K GGUF) on the user's llama-server, core suite, 3 trials per task.

| harness | trials passed (95% Wilson CI) | pass^3 | report |
|---|---|---|---|
| ah | 24/24 (86%–100%) | 8/8 tasks | [report](ah/report.md) |
| Hermes Agent | not run | | `OUT=examples/bench/h2h-2026-09-24-t3 bash scripts/h2h.sh --only hermes --trials 3` |
| dsh | not run | | `... --only dsh --trials 3` |

The Hermes and dsh columns must be run by the user, because the assistant session is not allowed to launch those agents. Until they exist, this table makes no comparative claim. Note: `ts-multifile-rename` passed every trial, but with 4 to 8 tool errors each (worth a look).
