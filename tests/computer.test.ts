import { describe, expect, test } from "bun:test";
import { computerTool, parseCombo, screenshotTool } from "../src/tools/computer.ts";
import { memorySaveTool } from "../src/tools/memory.ts";
import { ToolRegistry } from "../src/tools/index.ts";

const ctx = (computer?: "off" | "ask" | "auto") => ({ root: "/tmp", bashTimeoutMs: 1000, todos: [], readFiles: new Set<string>(), media: {}, computer });

describe("computer control", () => {
  test("parses key combos", () => {
    expect(parseCombo("cmd+shift+T")).toEqual({ mods: ["cmd", "shift"], key: "t" });
    expect(parseCombo("return")).toEqual({ mods: [], key: "return" });
    expect(() => parseCombo("+")).toThrow();
  });

  test("hidden when off; approval in every permission mode unless auto", async () => {
    const reg = new ToolRegistry();
    expect(reg.specs("auto", ctx("off")).map((s) => s.name)).not.toContain("computer");
    expect(reg.specs("auto", ctx()).map((s) => s.name)).not.toContain("screenshot");
    expect(reg.needsApproval(computerTool, { action: "click" }, "auto", ctx("ask"))).toBe(true);
    expect(reg.needsApproval(screenshotTool, {}, "auto", ctx("ask"))).toBe(true);
    expect(reg.needsApproval(computerTool, { action: "click" }, "auto", ctx("auto"))).toBe(false);
    // Denied without an approver, and nothing runs.
    if (computerTool.available!(ctx("ask"))) {
      const r = await reg.execute("computer", { action: "click", x: 1, y: 1 }, ctx("ask"), "auto");
      expect(r.denied).toBe(true);
    }
  });
});

test("memory_save follows the write mode; global notes always need approval", () => {
  const reg = new ToolRegistry();
  expect(reg.needsApproval(memorySaveTool, { text: "x" }, "ask", ctx())).toBe(true);
  expect(reg.needsApproval(memorySaveTool, { text: "x" }, "auto", ctx())).toBe(false);
  expect(reg.needsApproval(memorySaveTool, { text: "x", scope: "global" }, "auto", ctx())).toBe(true);
});
