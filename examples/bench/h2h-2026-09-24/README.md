# Head-to-head, 2026-09-24: ah column

Model: DavidAU/Qwen3.8-27B-TWIN-TURBO (Q6_K GGUF) on the user's llama-server, core suite, **1 trial** per task.

| harness | trials passed | notes |
|---|---|---|
| ah | 8/8 | [report](ah/report.md) |
| Hermes Agent | not run | the assistant session may not launch `hermes --yolo`; run `bash scripts/h2h.sh --only hermes --trials 1` with `OUT=examples/bench/h2h-2026-09-24` |
| dsh | not run | same; `--only dsh` |

One trial per task gives no useful confidence interval. Rerun with `--trials 3` before comparing. No claim of superiority is made from this table.
