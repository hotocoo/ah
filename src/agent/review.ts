import { textOf } from "../core/types.ts";
import type { Provider } from "../providers/provider.ts";
import { exec, formatExec } from "../tools/shell.ts";
import type { ToolContext } from "../tools/types.ts";

// A second opinion with a fresh context: the advisor (guidance mid-task) and the judge
// (is the goal met?). The reviewer is `advisorModel` when configured, else the session's
// own model; either way it sees the transcript as data, not as its own reasoning, and the
// harness evidence is labelled as the ground truth.
export interface Reviewer {
  provider: Provider;
  model: string;
  contextWindow?: number;
}

export interface ReviewContext {
  task: string;
  goal: string | null;
  transcript: string;
  evidence: string;
}

export interface Judgement {
  met: boolean;
  blocked?: boolean; // cannot progress without the user (a decision, credentials, missing resource)
  reason: string;
  check?: { command: string; passed: boolean };
}

const ADVISOR_SYSTEM = `You are a senior engineer advising a coding agent mid-task. You see its transcript and the harness's evidence (real tool results, checks run). Evidence is ground truth; the agent's own claims are not. Give short, concrete, prioritised advice: what is wrong or risky, what it has missed, the next step. Under 200 words. No preamble.`;

const JUDGE_SYSTEM = `You are an independent verifier. Decide whether a coding goal is actually met, from the evidence given: check output, the diff, and the agent's transcript. Do not trust the agent's claims of success; only what the diff and check output show. Answer on the first line with exactly MET, NOT MET or BLOCKED. BLOCKED only when the agent cannot make progress without the user (a decision, credentials, a missing external resource). Then, unless MET, say what is missing, wrong or needed, concretely (file, behaviour), in under 150 words.`;

// Keep the end of a long text: recent work matters most.
const tail = (s: string, max: number) => (s.length > max ? `[... ${s.length - max} earlier characters omitted]\n${s.slice(-max)}` : s);

// ≈3 characters per token, and at most half the reviewer's window for the material.
const budget = (r: Reviewer) => Math.floor((r.contextWindow ?? 32_768) * 1.5);

export async function ask(r: Reviewer, system: string, prompt: string, signal?: AbortSignal): Promise<string> {
  let text = "";
  for await (const ev of r.provider.stream({ model: r.model, system, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }], tools: [], maxTokens: 4096, contextWindow: r.contextWindow, signal })) {
    if (ev.type === "done") text = textOf(ev.message);
  }
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function advise(r: Reviewer, c: ReviewContext, question?: string, signal?: AbortSignal): Promise<string> {
  const b = budget(r);
  const prompt = [`<task>\n${c.task}\n</task>`, c.goal ? `<goal>\n${c.goal}\n</goal>` : "", `<evidence source="harness">\n${c.evidence}\n</evidence>`, `<transcript>\n${tail(c.transcript, b)}\n</transcript>`, question ? `The agent asks: ${question}` : "Advise the agent on how to proceed."];
  return (await ask(r, ADVISOR_SYSTEM, prompt.filter(Boolean).join("\n\n"), signal)) || "(the advisor returned nothing)";
}

// The check decides alone when it fails: a model cannot talk a failing test into a pass.
export async function judge(r: Reviewer, c: ReviewContext, criterion: string, ws: { toolContext: ToolContext; testCommand?: string | null }, signal?: AbortSignal): Promise<Judgement> {
  const b = budget(r);
  const ctx = { ...ws.toolContext, signal };
  let check: Judgement["check"];
  let checkText = "No test command detected; judge from the diff.";
  if (ws.testCommand) {
    const res = await exec(ws.testCommand, ctx, Math.max(ws.toolContext.bashTimeoutMs, 300_000));
    check = { command: ws.testCommand, passed: res.code === 0 && !res.timedOut };
    checkText = `$ ${ws.testCommand}\n${tail(formatExec(res), Math.floor(b / 4))}`;
  }
  const status = await exec("git status --short 2>/dev/null; git diff HEAD 2>/dev/null", ctx, 30_000);
  const prompt = [`<goal>\n${criterion}\n</goal>`, `<check>\n${checkText}\n</check>`, `<evidence source="harness">\n${c.evidence}\n</evidence>`, `<diff>\n${tail(status.stdout || "(no git repository or no changes)", Math.floor(b / 2))}\n</diff>`, `<transcript>\n${tail(c.transcript, Math.floor(b / 4))}\n</transcript>`].join("\n\n");
  const verdict = await ask(r, JUDGE_SYSTEM, prompt, signal);
  const said = /^\W*(NOT\s+MET|MET|BLOCKED)\b/i.exec(verdict)?.[1]?.toUpperCase().replace(/\s+/, " ");
  const reason = verdict.replace(/^\W*(NOT\s+MET|MET|BLOCKED)\b[:.\s-]*/i, "").trim();
  if (check && !check.passed) return { met: false, reason: `\`${check.command}\` fails. ${reason}`.trim(), check };
  return { met: said === "MET", ...(said === "BLOCKED" ? { blocked: true } : {}), reason: said ? reason || "(no reason given)" : `verifier gave no MET/NOT MET verdict: ${verdict.slice(0, 300)}`, check };
}
