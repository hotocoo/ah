import type { AgentEvent } from "../agent/events.ts";

const tty = process.stderr.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const dim = c("2");
export const bold = c("1");
export const red = c("31");
export const green = c("32");
export const yellow = c("33");
export const cyan = c("36");

const fmtMs = (ms: number | null | undefined) => (ms === null || ms === undefined ? "-" : ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`);
const fmtRate = (r?: number | null) => (r ? `${r.toFixed(1)} tok/s` : "-");

// Streams agent activity to the terminal: text to stdout, tool activity and stats to stderr.
export function terminalRenderer(opts: { verbose?: boolean; json?: boolean } = {}) {
  let inText = false;
  const err = (s: string) => {
    if (inText) {
      process.stdout.write("\n");
      inText = false;
    }
    process.stderr.write(`${s}\n`);
  };
  return (e: AgentEvent) => {
    if (opts.json) {
      if (e.type !== "text_delta" && e.type !== "thinking_delta" && e.type !== "tool_image") process.stdout.write(`${JSON.stringify(e)}\n`);
      return;
    }
    switch (e.type) {
      case "run_start":
        err(dim(`● ${e.provider}/${e.model}  ${e.runId}`));
        break;
      case "text_delta":
        process.stdout.write(e.text);
        inText = true;
        break;
      case "thinking_delta":
        if (opts.verbose) process.stderr.write(dim(e.text));
        break;
      case "tool_start":
        err(cyan(`  ⏵ ${e.summary}`));
        break;
      case "tool_end":
        err(`    ${e.isError ? red("✗") : green("✓")} ${dim(`${e.name} ${fmtMs(e.durationMs)}${e.changedFiles.length ? ` · ${e.changedFiles.join(", ")}` : ""}`)}${e.isError ? `\n    ${red(e.preview.split("\n")[0]!.slice(0, 200))}` : ""}`);
        break;
      case "model_response":
        if (opts.verbose)
          err(
            dim(
              `  turn ${e.turn}: ${fmtMs(e.latencyMs)} ttft ${fmtMs(e.ttftMs)} · in ${e.usage.inputTokens} out ${e.usage.outputTokens}` +
                (e.timings ? ` · prefill ${fmtRate(e.timings.prefillTokensPerSec)} decode ${fmtRate(e.timings.decodeTokensPerSec)}` : ` · ${fmtRate(e.outputTokensPerSec)}`) +
                (e.costUsd ? ` · $${e.costUsd.toFixed(4)}` : ""),
            ),
          );
        break;
      case "retry":
        err(yellow(`  ↻ retry ${e.attempt}: ${e.reason}`));
        break;
      case "compaction":
        err(yellow(`  ⇣ compacted context ${e.beforeTokens} → ${e.afterTokens} tokens (${e.strategy})`));
        break;
      case "tool_calls_recovered":
        err(dim(`  ↺ recovered ${e.count} tool call(s) from text (${e.formats.join(", ")})`));
        break;
      case "context_truncated":
        err(yellow(`  ⚠ runtime saw ${e.reportedTokens} of ~${e.estimatedTokens} tokens (window ${e.window}); compacting`));
        break;
      case "error":
        err(red(`  error: ${e.message}`));
        break;
      case "memory_recall":
        err(dim(`  ◆ recalled ${e.memories.length} memor${e.memories.length === 1 ? "y" : "ies"} (${e.memories.map((m) => `${m.kind} ${m.trust.toFixed(2)}`).join(", ")})`));
        break;
      case "evidence_gate":
        err(yellow(`  ⚑ ${e.lastFailed ? "last check failed" : "no check passed"} after changing ${e.files.join(", ")}; asking to verify`));
        break;
      case "run_end": {
        const r = e.result;
        const status = r.outcome === "completed" ? green(r.outcome) : yellow(r.outcome);
        err(
          dim(
            `\n■ ${status}${r.verdict && r.verdict !== "none" ? ` (${r.verdict})` : ""} · ${r.turns} turns · ${r.toolCalls} tools (${r.toolErrors} err) · ${fmtMs(r.wallMs)} · in ${r.usage.inputTokens} out ${r.usage.outputTokens}` +
              (r.costUsd ? ` · $${r.costUsd.toFixed(4)}` : "") +
              (r.changedFiles.length ? `\n  changed: ${r.changedFiles.join(", ")}` : ""),
          ),
        );
        break;
      }
    }
  };
}
