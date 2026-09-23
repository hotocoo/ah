import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLooping, RepetitionGuard } from "../src/agent/repetition.ts";
import { Agent } from "../src/agent/loop.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import type { ChatRequest, StreamEvent } from "../src/core/types.ts";
import { MockProvider } from "../src/providers/mock.ts";
import { ToolRegistry } from "../src/tools/index.ts";

describe("repetition guard", () => {
  test("flags back-to-back repeats, not normal code", () => {
    const loop = "Let me check the file again to be sure it is right. ".repeat(40);
    expect(isLooping(loop, 120, 8)).toBe(true);
    const code = Array.from({ length: 200 }, (_, i) => `const v${i} = compute(${i}, "${i * 7}");`).join("\n");
    expect(isLooping(code, 120, 8)).toBe(false);
    expect(isLooping(" ".repeat(5000), 120, 8)).toBe(false);
  });

  test("streaming guard trips once the loop is long enough", () => {
    const g = new RepetitionGuard();
    let tripped = false;
    for (let i = 0; i < 200 && !tripped; i++) tripped = g.push("I will now read the file and then fix it. ");
    expect(tripped).toBe(true);
  });

  test("agent cuts a looping turn and retries with a note", async () => {
    const root = mkdtempSync(join(tmpdir(), "ah-loop-"));
    let calls = 0;
    const seen: ChatRequest[] = [];
    const looping = {
      key: "loopy",
      kind: "mock",
      capabilities: new MockProvider().capabilities,
      async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
        seen.push(req);
        if (calls++ === 0) {
          for (let i = 0; i < 2000; i++) {
            if (req.signal?.aborted) return;
            yield { type: "thinking_delta", text: "hmm, let me think about this again carefully. " };
          }
        }
        yield { type: "done", message: { role: "assistant", content: [{ type: "text", text: "Done." }] }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } };
      },
    };
    const events: AgentEvent[] = [];
    const agent = new Agent({ provider: looping, model: "m", system: "s", tools: new ToolRegistry(), toolContext: { root, bashTimeoutMs: 1000, todos: [], readFiles: new Set(), media: {} }, mode: "auto", maxTurns: 5, maxTokens: 100, onEvent: (e) => events.push(e) });
    const r = await agent.run("x");
    expect(r.outcome).toBe("completed");
    expect(r.finalText).toBe("Done.");
    expect(events.some((e) => e.type === "retry" && e.reason.includes("repetitive"))).toBe(true);
    expect(JSON.stringify(seen[1]!.messages)).toContain("started repeating itself");
  });
});
