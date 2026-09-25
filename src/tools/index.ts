import type { ToolSpec } from "../core/types.ts";
import { editFileTool, listDirTool, multiEditTool, readFileTool, writeFileTool } from "./fs.ts";
import { advisorTool, generate3dTool, generateImageTool, gitTool, todoTool, webFetchTool } from "./misc.ts";
import { graphTool } from "./graph.ts";
import { computerTool, screenshotTool } from "./computer.ts";
import { memorySaveTool, memorySearchTool } from "./memory.ts";
import { validate } from "./schema.ts";
import { globTool, grepTool } from "./search.ts";
import { bashTool, isDangerousCommand, runTestsTool } from "./shell.ts";
import { ToolError, type Tool, type ToolContext, type ToolOutput } from "./types.ts";

export const ALL_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  multiEditTool,
  listDirTool,
  globTool,
  grepTool,
  graphTool,
  bashTool,
  runTestsTool,
  gitTool,
  advisorTool,
  todoTool,
  webFetchTool,
  generateImageTool,
  generate3dTool,
  memorySearchTool,
  memorySaveTool,
  screenshotTool,
  computerTool,
];

export type PermissionMode = "ask" | "auto" | "read-only";

export interface ToolCallOutcome extends ToolOutput {
  durationMs: number;
  denied?: boolean;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(tools: Tool[] = ALL_TOOLS) {
    for (const t of tools) this.tools.set(t.spec.name, t);
  }

  // Tools offered to the model: permitted by the mode, available in this context, and
  // (in the compact profile) not optional.
  specs(mode: PermissionMode = "auto", ctx?: ToolContext, compact = false): ToolSpec[] {
    return [...this.tools.values()]
      .filter((t) => mode !== "read-only" || t.readOnly)
      .filter((t) => !ctx || !t.available || t.available(ctx))
      .filter((t) => !compact || !t.optional)
      .map((t) => t.spec);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  // Needs approval when: mode is ask and tool writes, or the command is dangerous in any mode.
  needsApproval(tool: Tool, input: Record<string, unknown>, mode: PermissionMode, ctx?: ToolContext): boolean {
    if (ctx && tool.needsApproval?.(input, ctx)) return true;
    if (tool.spec.name === "bash" && typeof input.command === "string" && isDangerousCommand(input.command, ctx?.root)) return true;
    return mode === "ask" && !tool.readOnly;
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
    mode: PermissionMode,
    approve?: (tool: string, input: Record<string, unknown>, summary: string) => Promise<boolean>,
  ): Promise<ToolCallOutcome> {
    const start = performance.now();
    const done = (o: ToolOutput & { denied?: boolean }): ToolCallOutcome => ({ ...o, durationMs: performance.now() - start });
    const tool = this.tools.get(name);
    if (!tool) return done({ content: `unknown tool: ${name}. Available: ${this.names().join(", ")}`, isError: true });
    if (mode === "read-only" && !tool.readOnly) return done({ content: `${name} is disabled in read-only mode`, isError: true, denied: true });
    if (tool.available && !tool.available(ctx)) return done({ content: `${name} is not available here (no backend or precondition)`, isError: true });
    const errors = validate(tool.spec.inputSchema, input);
    if (errors.length) return done({ content: `invalid input for ${name}:\n${errors.join("\n")}`, isError: true });
    if (this.needsApproval(tool, input, mode, ctx)) {
      const summary = tool.summarize?.(input) ?? name;
      const ok = approve ? await approve(name, input, summary) : false;
      if (!ok) return done({ content: `user denied: ${summary}`, isError: true, denied: true });
    }
    try {
      return done(await tool.run(input, ctx));
    } catch (err) {
      const msg = err instanceof ToolError ? err.message : `${(err as Error).name}: ${(err as Error).message}`;
      return done({ content: msg, isError: true });
    }
  }
}
