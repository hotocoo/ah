# Telemetry

All telemetry is local by default: SQLite at `~/.ah/telemetry.sqlite`, daily JSONL event logs at `~/.ah/events/`, and optional OTLP export. Disable with `AH_TELEMETRY=0`; disable hardware sampling with `AH_HW=0`.

## What is recorded

**Per run** (`runs`): run/session id, provider, model, workspace, prompt (first 4000 chars), outcome, turns, tool calls, tool errors, tokens (input incl. cache, output incl. reasoning, cache read/write, reasoning), cost (null when pricing unknown; 0 for local), wall time, first-turn TTFT, changed files, error, context window used, GPU utilisation average, GPU memory peak, energy, benchmark tags.

**Per model turn** (`turns`, keyed by run, turn, attempt): context tokens sent, latency, TTFT, output tok/s measured by `ah`, stop reason, token usage, cost, tool calls requested, **runtime timings** (prefill tok/s, decode tok/s, runtime prompt ms, KV-cache-reused prompt tokens, model load ms), hardware for the turn window (GPU util avg/max, GPU memory peak, power, energy).

**Per tool call** (`tool_calls`): name, input (8 KB), duration, error, denied, output size, changed files.

**Every event** (`events`): the full typed event stream except streaming deltas: `run_start`, `turn_start`, `model_request`, `first_token`, `model_response`, `retry`, `tool_start`, `tool_end`, `tool_calls_recovered`, `context_truncated`, `compaction`, `error`, `run_end`.

## Hardware sampling

Sampled once per second while a run is active, attributed to turns and runs:

| platform | source (no sudo) | fields |
|---|---|---|
| macOS / Apple Silicon | `ioreg -r -d 1 -c IOAccelerator` (PerformanceStatistics) | GPU utilisation %, GPU-allocated and in-use unified memory |
| macOS + `macmon` installed | `macmon pipe` | SoC power → energy |
| Linux / NVIDIA | `nvidia-smi --query-gpu=...` | utilisation, memory, power, name |
| all | Node `os` | total/free memory, load average, CPU count |

Unavailable values are stored as NULL, never guessed.

## Reading it

```bash
ah telemetry                     # totals, outcomes, distributions (latency, TTFT, tok/s, context)
ah telemetry --since 24h --model ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF
ah telemetry runs | tools | models
ah telemetry run <run_id>        # turns, tool calls, events as JSON
ah telemetry sql "SELECT model, AVG(decode_tps) FROM turns JOIN runs USING(run_id) GROUP BY model"
ah serve                         # web dashboard
```

`telemetry sql` opens a separate read-only connection.

## OTLP

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (or `telemetry.otlpEndpoint` in config) to export traces over OTLP/HTTP JSON (`POST {endpoint}/v1/traces`). Span tree per run: `invoke_agent ah` → `chat <model>` per turn and `execute_tool <name>` per call, with OpenTelemetry GenAI semantic-convention attributes (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.operation.name`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`, `gen_ai.tool.name`, `gen_ai.tool.call.id`) plus `ah.*` attributes (TTFT, tok/s, cost, outcome). Works with Langfuse, Grafana Tempo, Jaeger, Honeycomb, Datadog. Export never blocks or breaks a run; spans stay in SQLite if the collector is down.
