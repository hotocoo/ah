import type { ContentBlock, Message } from "../core/types.ts";

// Cheap token estimate (~4 chars/token for code and English). Images count as a flat 1.5k.
export function estimateTokens(messages: Message[], system = ""): number {
  let chars = system.length;
  for (const m of messages)
    for (const b of m.content) {
      if (b.type === "text" || b.type === "thinking") chars += b.text.length;
      else if (b.type === "tool_result") chars += b.content.length;
      else if (b.type === "tool_call") chars += JSON.stringify(b.input).length + b.name.length;
      else if (b.type === "image") chars += 6000;
    }
  return Math.ceil(chars / 4);
}

const isToolResultMessage = (m: Message) => m.role === "user" && m.content.some((b) => b.type === "tool_result");

// Index where a kept tail may start: a plain user message, so no tool_result is
// separated from its tool_call.
export function safeCutIndex(messages: Message[], keepLast: number): number {
  for (let i = Math.max(1, messages.length - keepLast); i > 0; i--) {
    const m = messages[i]!;
    if (m.role === "user" && !isToolResultMessage(m)) return i;
  }
  return 0;
}

// First pass, no model call: elide the bodies of old, large tool results.
export function elideOldToolResults(messages: Message[], keepRecent = 6, maxChars = 2000): Message[] {
  const cutoff = messages.length - keepRecent;
  return messages.map((m, i) => {
    if (i >= cutoff || !isToolResultMessage(m)) return m;
    return {
      ...m,
      content: m.content.map((b): ContentBlock =>
        b.type === "tool_result" && b.content.length > maxChars
          ? { ...b, content: `${b.content.slice(0, 600)}\n[... ${b.content.length - 1200} chars elided to save context ...]\n${b.content.slice(-600)}` }
          : b,
      ),
    };
  });
}

// Removes thinking blocks: after history is rewritten, their provider signatures
// no longer match the surrounding context.
export const stripThinking = (messages: Message[]): Message[] =>
  messages.map((m) => ({ ...m, content: m.content.filter((b) => b.type !== "thinking") }));

export const COMPACTION_PROMPT = `Summarize the conversation so far for a coding agent that will continue the task with no other memory. Include:
1. The user's original request and any later changes to it, verbatim where precise.
2. Files read, created or modified, with the key facts learned about each.
3. Commands run and their important results (test failures, errors).
4. Decisions made and why.
5. Current state: what is done, what remains, the immediate next step.
Be dense and factual. Use bullet points. Do not invent anything.`;

export function renderTranscript(messages: Message[]): string {
  return messages
    .map((m) => {
      const body = m.content
        .map((b) => {
          if (b.type === "text") return b.text;
          if (b.type === "tool_call") return `[tool_call ${b.name} ${JSON.stringify(b.input).slice(0, 2000)}]`;
          if (b.type === "tool_result") return `[tool_result${b.isError ? " ERROR" : ""}] ${b.content.slice(0, 3000)}`;
          if (b.type === "image") return "[image]";
          return "";
        })
        .filter(Boolean)
        .join("\n");
      return `## ${m.role}\n${body}`;
    })
    .join("\n\n");
}
