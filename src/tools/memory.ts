import { str, ToolError, type Tool } from "./types.ts";

// Memory writes go to the ah data directory, not the workspace, so both tools count as
// read-only for permission purposes (they can run in parallel and in read-only mode).
export const memorySearchTool: Tool = {
  readOnly: true,
  optional: true,
  spec: {
    name: "memory_search",
    description: "Search persistent memory from earlier sessions (lessons the harness verified, your own notes, session summaries). Results carry a trust score.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"] },
  },
  available: (ctx) => Boolean(ctx.memory),
  summarize: (i) => `recall "${i.query}"`,
  async run(input, ctx) {
    const m = ctx.memory!;
    const hits = m.store.search(str(input, "query"), m.scopes, (input.limit as number | undefined) ?? 8);
    return { content: hits.map((h) => `#${h.id} [${h.kind}, trust ${h.trust.toFixed(2)}, used ${h.uses}x] ${h.text}`).join("\n") || "no matching memories" };
  },
};

export const memorySaveTool: Tool = {
  readOnly: true,
  optional: true,
  spec: {
    name: "memory_save",
    description:
      "Save a durable fact for future sessions: a user preference, a project convention, a non-obvious command or pitfall. Not for task progress. scope \"global\" applies to every workspace; default is this workspace.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, scope: { type: "string", enum: ["workspace", "global"] } }, required: ["text"] },
  },
  available: (ctx) => Boolean(ctx.memory),
  summarize: (i) => `remember "${String(i.text ?? "").slice(0, 60)}"`,
  async run(input, ctx) {
    const m = ctx.memory!;
    const text = str(input, "text");
    if (text.length > 2000) throw new ToolError("memory text is limited to 2000 characters; save the essential fact");
    const scope = input.scope === "global" ? "global" : m.scopes[0]!;
    const id = m.store.save({ scope, kind: "note", text });
    return { content: `saved memory #${id} (${scope === "global" ? "global" : "workspace"}, unverified note)` };
  },
};
