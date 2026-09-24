import { validate } from "../tools/schema.ts";
import { ToolError, type Tool } from "../tools/types.ts";

// Deferred MCP tools: instead of every server's full JSON schemas in every request (42 tools from
// four common servers cost ~6.3k tokens, six times ah's own tool set), the model gets one `mcp`
// tool and a one-line index. A call with missing or wrong arguments returns that tool's schema,
// so the full definition is paid for once, only for the tools actually used.

const firstSentence = (s: string) => (s.split(/(?<=[.!?])\s|\n/)[0] ?? "").replace(/^\[MCP [^\]]+\]\s*/, "").slice(0, 100);

export function deferMcpTools(tools: Tool[]): { tool: Tool; index: string } {
  const byName = new Map(tools.map((t) => [t.spec.name, t]));
  const names = [...byName.keys()].sort();
  const tool: Tool = {
    readOnly: false,
    optional: true,
    spec: {
      name: "mcp",
      description: "Call an MCP server tool listed under 'MCP tools'. If arguments are missing or invalid, the result is the tool's input schema; call again with arguments matching it.",
      inputSchema: {
        type: "object",
        properties: {
          tool: { type: "string", enum: names, description: "Tool name from the MCP tools list" },
          arguments: { type: "object", description: "Arguments for that tool" },
        },
        required: ["tool"],
      },
    },
    summarize: (i) => byName.get(String(i.tool))?.summarize?.((i.arguments as Record<string, unknown>) ?? {}) ?? `mcp ${String(i.tool)}`,
    async run(input, ctx) {
      const t = byName.get(String(input.tool));
      if (!t) throw new ToolError(`unknown MCP tool ${String(input.tool)}; choose one from the MCP tools list`);
      const args = (input.arguments ?? {}) as Record<string, unknown>;
      const errors = validate(t.spec.inputSchema, args);
      if (errors.length) throw new ToolError(`${errors.join("; ")}\n${t.spec.name} input schema:\n${JSON.stringify(t.spec.inputSchema)}`);
      return t.run(args, ctx);
    },
  };
  const index = names.map((n) => `- ${n}: ${firstSentence(byName.get(n)!.spec.description)}`).join("\n");
  return { tool, index: `MCP tools (call through the \`mcp\` tool):\n${index}` };
}

// "auto" defers when the MCP schemas are larger than ah's own tool definitions.
export function shouldDefer(mode: "auto" | "inline" | "deferred", mcpTools: Tool[], coreTools: Tool[]): boolean {
  if (mode !== "auto") return mode === "deferred" && mcpTools.length > 0;
  const size = (ts: Tool[]) => JSON.stringify(ts.map((t) => t.spec)).length;
  return mcpTools.length > 0 && size(mcpTools) > size(coreTools);
}
