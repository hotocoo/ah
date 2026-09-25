// Console: sessions, transcript and composer. Runs live on the server, independent of this
// page; the page renders a session's event stream (replayed on open, followed while a run is
// in progress). Model output is untrusted: every dynamic string goes through esc.
import { TOKEN, $, api, esc, num, ms, compact, plural, clamp01, html, alertBox, ago } from "/util.js";
import { fx } from "/fx.js";

const state = { sessionId: null, busy: false, follow: null, view: null, title: "New session" };
const LAST_SESSION = "ah.lastSession";

// ---------- live instrument (right panel) ----------
const inst = {
  set(s) {
    const el = $("#run-state");
    el.dataset.state = s;
    el.textContent = s;
    fx.energy(s);
  },
  reset() {
    this.set("idle");
    ["#run-turn", "#run-ttft", "#run-tps", "#run-tools"].forEach((s) => ($(s).textContent = "-"));
    this.ctx(0, 0);
    $("#run-trace").innerHTML = `<li class="trace-empty">Events stream here while a task runs.</li>`;
  },
  ctx(used, window) {
    const f = window ? clamp01(used / window) : 0;
    const m = $("#run-ctx");
    m.querySelector("span").style.setProperty("--v", f);
    m.classList.toggle("hot", f > 0.8);
    m.setAttribute("aria-valuenow", String(Math.round(f * 100)));
    $("#run-ctx-label").textContent = window ? `${compact(used)} / ${compact(window)}` : "-";
  },
  trace(text, kind = "") {
    const list = $("#run-trace");
    list.querySelector(".trace-empty")?.remove();
    const li = document.createElement("li");
    li.className = kind ? `k-${kind}` : "";
    li.innerHTML = `<time>${esc(new Date().toLocaleTimeString())}</time>${esc(text)}`;
    list.append(li);
    if (list.childElementCount > 400) list.firstElementChild.remove();
    list.scrollTop = list.scrollHeight;
  },
};

// ---------- markdown: a safe subset (escape first, then add tags; no links or raw HTML) ----------
const BLOCK = /^\s*(```|#{1,4}\s|[-*]\s|\d+[.)]\s|\|)/;
function inline(s) {
  return s
    .split(/(`[^`\n]+`)/)
    .map((p) => (p.length > 1 && p.startsWith("`") && p.endsWith("`") ? `<code>${esc(p.slice(1, -1))}</code>` : esc(p).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>")))
    .join("");
}
export function markdown(src) {
  const out = [];
  const lines = src.split("\n");
  let i = 0;
  const run = (re) => {
    const items = [];
    while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ""));
    return items;
  };
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="code"><code>${esc(buf.join("\n"))}</code></pre>`);
    } else if (/^#{1,4}\s/.test(l)) {
      out.push(`<p class="md-h">${inline(l.replace(/^#+\s+/, ""))}</p>`);
      i++;
    } else if (/^\s*[-*]\s+/.test(l)) out.push(`<ul>${run(/^\s*[-*]\s+/).map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
    else if (/^\s*\d+[.)]\s+/.test(l)) out.push(`<ol>${run(/^\s*\d+[.)]\s+/).map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`);
    else if (/^\s*\|/.test(l)) {
      const rows = run(/^(?=\s*\|)/).filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r));
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|");
      out.push(`<table class="md-table">${rows.map((r, k) => `<tr>${cells(r).map((c) => (k ? `<td>${inline(c.trim())}</td>` : `<th>${inline(c.trim())}</th>`)).join("")}</tr>`).join("")}</table>`);
    } else if (!l.trim()) i++;
    else {
      const buf = [l];
      i++;
      while (i < lines.length && lines[i].trim() && !BLOCK.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${inline(buf.join("\n"))}</p>`);
    }
  }
  return out.join("");
}

// ---------- tool rows ----------
const KIND = { read_file: "read", list_dir: "read", repo_map: "read", git_status: "read", glob: "find", grep: "find", memory_search: "find", edit_file: "edit", multi_edit: "edit", write_file: "edit", bash: "run", run_tests: "test", web_fetch: "web", todo_write: "plan", screenshot: "screen", computer: "screen", generate_image: "media", generate_3d: "media", memory_save: "note" };
const VERB = { read: ["read", "file"], find: ["searched", "time"], edit: ["edited", "file"], run: ["ran", "command"], test: ["ran tests", ""], web: ["fetched", "page"], plan: ["updated plan", ""], screen: ["used screen", ""], media: ["generated", "asset"], note: ["saved", "note"], tool: ["called", "tool"] };
const kindOf = (name) => KIND[name] ?? "tool";

function countsLabel(tools) {
  const by = new Map();
  for (const t of tools) by.set(t.kind, (by.get(t.kind) ?? 0) + 1);
  const parts = [...by].map(([k, n]) => {
    const [verb, noun] = VERB[k] ?? VERB.tool;
    return noun ? `${verb} ${plural(n, noun)}` : n > 1 ? `${verb} ×${n}` : verb;
  });
  const s = parts.join(", ");
  return s ? s[0].toUpperCase() + s.slice(1) : "Working";
}

function lineDiff(path, a, b) {
  const al = a ? String(a).split("\n") : [];
  const bl = b ? String(b).split("\n") : [];
  let p = 0;
  while (p < al.length && p < bl.length && al[p] === bl[p]) p++;
  let q = 0;
  while (q < al.length - p && q < bl.length - p && al[al.length - 1 - q] === bl[bl.length - 1 - q]) q++;
  const rows = [
    ...al.slice(Math.max(0, p - 2), p).map((l) => ["c", " ", l]),
    ...al.slice(p, al.length - q).map((l) => ["d", "-", l]),
    ...bl.slice(p, bl.length - q).map((l) => ["a", "+", l]),
    ...al.slice(al.length - q, al.length - q + 2).map((l) => ["c", " ", l]),
  ].slice(0, 400);
  return { add: bl.length - p - q, del: al.length - p - q, html: `<div class="diff"><div class="diff-head">${esc(path)}</div><pre>${rows.map(([c, k, l]) => `<span class="d${c}">${k} ${esc(l)}</span>`).join("")}</pre></div>` };
}
function editDiffs(name, input) {
  if (name === "edit_file") return [lineDiff(input.path, input.old_string, input.new_string)];
  if (name === "multi_edit") return (input.edits ?? []).map((e) => lineDiff(input.path, e.old_string, e.new_string));
  if (name === "write_file") return [lineDiff(input.path, "", String(input.content ?? "").split("\n").slice(0, 200).join("\n"))];
  return [];
}
function toolBody(t) {
  const diffs = editDiffs(t.name, t.input);
  let h = diffs.map((d) => d.html).join("");
  if (t.name === "bash") h += `<pre class="cmd">$ ${esc(t.input.command ?? "")}</pre>`;
  else if (!diffs.length) h += `<pre class="args">${esc(JSON.stringify(t.input, null, 2).slice(0, 4000))}</pre>`;
  if (t.preview !== undefined) h += `<pre class="out${t.isError ? " err" : ""}">${esc(t.preview || "(no output)")}</pre>`;
  return h;
}

// ---------- transcript view: turns agent events into DOM (same path for live and replay) ----------
function createView(log) {
  let msg = null;
  let textEl = null;
  let textBuf = "";
  let thinkEl = null;
  let step = null;
  let renderQueued = false;
  const tools = new Map();
  const cards = new Map();
  const run = { turns: 0, tools: 0, input: 0, output: 0, cacheRead: 0, tps: null, start: 0, end: 0, ctxWindow: 0 };

  const stick = () => log.scrollHeight - log.scrollTop - log.clientHeight < 160;
  const scroll = (was) => was && (log.scrollTop = log.scrollHeight);
  const agentMsg = () => msg ?? (log.append((msg = Object.assign(document.createElement("div"), { className: "msg agent" }))), msg);
  const where = () => (step ? step.body : agentMsg());

  function endThinking() {
    if (!thinkEl) return;
    const secs = (performance.now() - Number(thinkEl.dataset.start)) / 1000;
    thinkEl.querySelector("summary").textContent = thinkEl.dataset.replay ? "Thought" : `Thought for ${secs < 10 ? num(secs, 1) : num(secs)}s`;
    thinkEl.open = false;
    thinkEl = null;
  }
  function flushText() {
    renderQueued = false;
    if (textEl) textEl.innerHTML = markdown(textBuf);
  }
  function endText() {
    if (textEl) flushText();
    textEl = null;
    textBuf = "";
  }
  function stepSummary() {
    if (!step) return;
    const running = step.tools.some((t) => !t.done);
    const errs = step.tools.filter((t) => t.isError).length;
    const label = countsLabel(step.tools);
    step.el.querySelector(".step-title").textContent = step.title ?? label;
    step.el.querySelector(".step-meta").textContent = [step.title ? label : "", errs ? `${errs} failed` : "", running ? "" : ms(step.end - step.start)].filter(Boolean).join(" · ");
    step.el.classList.toggle("has-err", errs > 0);
    step.el.classList.toggle("running", running);
  }
  function endStep() {
    if (!step) return;
    stepSummary();
    if (!step.el.classList.contains("has-err") && !step.el.querySelector(".approval:not(.done)")) step.el.open = false;
    step = null;
  }
  function ensureStep(t) {
    if (step) return step;
    endThinking();
    // A short line of text right before the tools names the step ("Reading the config...").
    let title = null;
    const lead = textBuf.trim();
    if (textEl && lead && lead.length <= 140 && !lead.includes("\n")) {
      title = lead.replace(/[:.]$/, "");
      textEl.remove();
      textEl = null;
      textBuf = "";
    }
    endText();
    const el = html(`<details class="step running" open><summary><span class="step-title"></span><span class="step-meta"></span></summary><div class="step-body"></div></details>`).firstElementChild;
    agentMsg().append(el);
    step = { el, body: el.querySelector(".step-body"), title, tools: [], start: t, end: t };
    return step;
  }
  function plan(todos) {
    const box = $("#chat-plan");
    if (!Array.isArray(todos) || !todos.length) return void (box.hidden = true);
    const done = todos.filter((t) => t.status === "completed").length;
    const next = todos.find((t) => t.status === "in_progress") ?? todos.find((t) => t.status !== "completed");
    const open = box.querySelector("details")?.open ?? false;
    box.hidden = false;
    box.innerHTML = `<details ${open ? "open" : ""}><summary><span class="plan-count">${done}/${todos.length}</span><span class="plan-next">${esc(next ? next.content : "All steps done")}</span></summary><ol>${todos.map((t) => `<li class="p-${esc(t.status)}">${esc(t.content)}</li>`).join("")}</ol></details>`;
  }
  function stats() {
    const cache = run.input ? run.cacheRead / run.input : null;
    const wall = (run.end || performance.now()) - run.start;
    $("#chat-stats").innerHTML = run.start
      ? [plural(run.turns, "turn"), plural(run.tools, "tool"), run.tps ? `${num(run.tps, 1)} tok/s` : "", `${compact(run.input + run.output)} tok`, cache !== null && run.cacheRead ? `cache ${num(cache * 100)}%` : "", ms(wall)].filter(Boolean).map((s) => `<span>${esc(s)}</span>`).join("")
      : "";
  }

  function approvalCard(ev) {
    const el = html(`<div class="approval" role="group" aria-labelledby="ap-${esc(ev.id)}"><p id="ap-${esc(ev.id)}">Allow <code>${esc(ev.summary)}</code>?</p><details><summary>${esc(ev.tool)} input</summary><pre>${esc(ev.input)}</pre></details><div class="approval-actions"><button type="button" data-a="allow" class="primary">Allow</button><button type="button" data-a="always">Always allow ${esc(ev.tool)}</button><button type="button" data-a="deny">Deny</button></div></div>`).firstElementChild;
    el.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", async () => {
        const a = b.dataset.a;
        el.querySelectorAll("button").forEach((x) => (x.disabled = true));
        try {
          await api("/api/approve", { id: ev.id, allow: a !== "deny", always: a === "always" });
        } catch (err) {
          el.querySelectorAll("button").forEach((x) => (x.disabled = false));
          el.append(alertBox("Could not send decision", err.message));
        }
      }),
    );
    cards.set(ev.id, el);
    return el;
  }

  function handle(ev, replay) {
    const was = stick();
    const now = performance.now();
    switch (ev.type) {
      case "user":
      case "steer": {
        if (ev.type === "steer") {
          const pending = log.querySelector(".msg.user.pending");
          if (pending) {
            pending.classList.remove("pending");
            pending.querySelector(".tag")?.remove();
            break;
          }
        }
        endThinking();
        endStep();
        endText();
        msg = null;
        log.querySelector(".welcome")?.remove();
        log.insertAdjacentHTML("beforeend", `<div class="msg user${ev.type === "steer" ? " steer" : ""}"><div class="text">${esc(ev.text)}</div></div>`);
        break;
      }
      case "session":
        run.ctxWindow = ev.contextWindow ?? 0;
        $("#chat-meta").textContent = `${ev.model} · ${compact(ev.contextWindow)} context`;
        if (ev.mode) $("#chat-mode").value = ev.mode;
        inst.ctx(0, run.ctxWindow);
        break;
      case "run_start":
        Object.assign(run, { turns: 0, tools: 0, input: 0, output: 0, cacheRead: 0, tps: null, start: now, end: 0 });
        if (!replay) inst.reset(), inst.set("thinking"), inst.trace("task started", "gold"), ($("#run-tools").textContent = "0");
        break;
      case "turn_start":
        run.turns++;
        if (!replay) {
          $("#run-turn").textContent = String(ev.turn);
          inst.ctx(ev.contextTokens, run.ctxWindow);
          inst.set("thinking");
          inst.trace(`turn ${ev.turn} · ${compact(ev.contextTokens)} context tokens`);
        }
        break;
      case "first_token":
        if (!replay) $("#run-ttft").textContent = ms(ev.ttftMs);
        break;
      case "thinking_delta":
        if (!thinkEl) {
          thinkEl = html(`<details class="thinking" open><summary>Thinking</summary><div></div></details>`).firstElementChild;
          thinkEl.dataset.start = String(now);
          if (replay) thinkEl.dataset.replay = "1";
          (step && step.tools.every((t) => t.done) ? step.body : where()).append(thinkEl);
        }
        thinkEl.lastElementChild.textContent += ev.text;
        break;
      case "text_delta":
        endThinking();
        endStep();
        if (!textEl) agentMsg().append((textEl = Object.assign(document.createElement("div"), { className: "text md" })));
        textBuf += ev.text;
        if (replay) flushText();
        else if (!renderQueued) (renderQueued = true), requestAnimationFrame(flushText);
        break;
      case "model_response":
        endThinking();
        run.input += ev.usage?.inputTokens ?? 0;
        run.output += ev.usage?.outputTokens ?? 0;
        run.cacheRead += ev.usage?.cacheReadTokens ?? 0;
        if (ev.outputTokensPerSec) run.tps = ev.outputTokensPerSec;
        if (!replay) {
          if (ev.outputTokensPerSec) $("#run-tps").textContent = `${num(ev.outputTokensPerSec, 1)}/s`;
          inst.trace(`response · ${num(ev.usage?.outputTokens)} out · ${ms(ev.latencyMs)}`);
        }
        break;
      case "tool_start": {
        const s = ensureStep(now);
        const kind = kindOf(ev.name);
        const t = { id: ev.id, name: ev.name, kind, input: ev.input ?? {}, done: false, isError: false, start: now, el: null };
        t.el = html(`<div class="tool k-${kind} running"><button type="button" class="tool-head" aria-expanded="false"><span class="tk">${esc(kind)}</span><span class="sum">${esc(ev.summary)}</span><span class="delta"></span><span class="dur"${replay ? "" : ` data-start="${now}"`}>${replay ? "" : "0.0s"}</span></button><div class="tool-body" hidden></div></div>`).firstElementChild;
        const head = t.el.querySelector(".tool-head");
        head.addEventListener("click", () => {
          const body = t.el.querySelector(".tool-body");
          const open = body.hidden;
          if (open && !body.dataset.built) (body.innerHTML = toolBody(t)), (body.dataset.built = "1");
          body.hidden = !open;
          head.setAttribute("aria-expanded", String(open));
        });
        const diffs = editDiffs(ev.name, t.input);
        if (diffs.length) t.el.querySelector(".delta").innerHTML = `<span class="add">+${diffs.reduce((a, d) => a + d.add, 0)}</span><span class="del">-${diffs.reduce((a, d) => a + d.del, 0)}</span>`;
        if (ev.name === "todo_write") plan(t.input.todos);
        tools.set(ev.id, t);
        s.tools.push(t);
        s.body.append(t.el);
        run.tools++;
        stepSummary();
        if (!replay) $("#run-tools").textContent = String(run.tools), inst.set("tool"), inst.trace(`${ev.name} started`, "gold");
        break;
      }
      case "tool_end": {
        const t = tools.get(ev.id);
        if (t) {
          Object.assign(t, { done: true, isError: ev.isError, preview: ev.preview });
          t.el.classList.remove("running");
          t.el.classList.add(ev.isError ? "err" : "done");
          const dur = t.el.querySelector(".dur");
          dur.removeAttribute("data-start");
          dur.textContent = ev.denied ? "denied" : ms(ev.durationMs);
          if (ev.isError) t.el.insertAdjacentHTML("beforeend", `<span class="note">${esc((ev.preview ?? "").split("\n")[0].slice(0, 200))}</span>`);
          const body = t.el.querySelector(".tool-body");
          if (body.dataset.built) body.innerHTML = toolBody(t);
          if (step) (step.end = now), stepSummary();
        }
        if (!replay) inst.trace(`${ev.name} ${ev.denied ? "denied" : ev.isError ? "failed" : "ok"} · ${ms(ev.durationMs)}`, ev.isError ? "bad" : "ok"), inst.set("thinking");
        break;
      }
      case "approval_request": {
        const card = approvalCard(ev);
        (step ? step.body : agentMsg()).append(card);
        if (!replay) card.querySelector("button").focus({ preventScroll: true }), inst.set("waiting"), inst.trace(`waiting for approval · ${ev.summary}`, "gold");
        break;
      }
      case "approval_result": {
        const card = cards.get(ev.id);
        if (!card) break;
        card.classList.add("done", ev.allow ? "allowed" : "denied");
        card.querySelector(".approval-actions").textContent = ev.allow ? "Allowed" : ev.reason ? `Denied (${ev.reason})` : "Denied";
        break;
      }
      case "tool_image":
        if (!replay) showScreen(ev);
        break;
      case "memory_recall":
        agentMsg().append(html(`<details class="recall"><summary>Recalled ${ev.memories.length === 1 ? "1 memory" : `${ev.memories.length} memories`}</summary><ul>${ev.memories.map((m) => `<li><span class="tag ${m.kind === "lesson" ? "gold" : ""}">${esc(m.kind)} ${esc(num(m.trust, 2))}</span> ${esc(m.text)}</li>`).join("")}</ul></details>`));
        break;
      case "retry":
      case "compaction":
      case "tool_calls_recovered":
      case "evidence_gate": {
        const text =
          ev.type === "retry" ? `Retry ${ev.attempt}: ${ev.reason}` : ev.type === "compaction" ? `Context compacted ${compact(ev.beforeTokens)} → ${compact(ev.afterTokens)} tokens (${ev.strategy})` : ev.type === "tool_calls_recovered" ? `Recovered ${plural(ev.count, "tool call")} written as text (${ev.formats.join(", ")})` : `Asked for a passing check after editing ${ev.files.join(", ")}`;
        where().insertAdjacentHTML("beforeend", `<div class="note-row k-${ev.type}">${esc(text)}</div>`);
        if (ev.type === "compaction" && !replay) inst.ctx(ev.afterTokens, run.ctxWindow);
        if (!replay) inst.trace(text, ev.type === "retry" ? "bad" : "gold");
        break;
      }
      case "evidence":
        if (!replay && ev.lessons.length) inst.trace(`learned ${plural(ev.lessons.length, "lesson")}`, "ok");
        break;
      case "run_end": {
        endThinking();
        endStep();
        endText();
        run.end = now;
        const r = ev.result;
        const chip = (v, cls = "") => `<span class="chip ${cls}">${esc(v)}</span>`;
        const verdict = r.verdict && r.verdict !== "unverified" ? chip(r.verdict, r.verdict === "verified" ? "ok" : "bad") : "";
        agentMsg().insertAdjacentHTML("beforeend", `<div class="stats">${chip(r.outcome, r.outcome === "completed" ? "ok" : "bad")}${verdict}${chip(plural(r.turns, "turn"))}${chip(plural(r.toolCalls, "tool"))}${chip(ms(r.wallMs))}${chip(`${compact(r.usage.inputTokens)} in · ${compact(r.usage.outputTokens)} out`)}${r.changedFiles.length ? chip(`changed ${r.changedFiles.join(", ")}`) : ""}</div>`);
        if (!replay) inst.set(r.outcome === "completed" ? "done" : "error"), inst.trace(`run ${r.outcome} · ${ms(r.wallMs)}`, r.outcome === "completed" ? "ok" : "bad");
        msg = null;
        break;
      }
      case "error":
        agentMsg().append(alertBox("Agent error", ev.message));
        if (!replay) inst.set("error"), inst.trace(ev.message, "bad");
        break;
    }
    stats();
    scroll(was);
  }
  return { handle, tick: stats, finish: () => (endThinking(), endStep(), endText()) };
}

function showScreen(ev) {
  $("#run-screen").hidden = false;
  $("#run-screen-img").src = `data:${ev.mediaType};base64,${ev.data}`;
  $("#run-screen-label").textContent = `${ev.name} · ${new Date().toLocaleTimeString()}`;
}

// One timer while busy: running tool durations, step and run elapsed.
setInterval(() => {
  if (!state.busy) return;
  const now = performance.now();
  document.querySelectorAll(".tool .dur[data-start]").forEach((d) => (d.textContent = `${num((now - Number(d.dataset.start)) / 1000, 1)}s`));
  state.view?.tick();
}, 200);

// ---------- streaming ----------
async function consume(res, view, replay) {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status} ${res.statusText}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  // Replayed history renders without per-event animation; once it catches up, events are live.
  let live = !replay;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const ev = JSON.parse(buf.slice(0, i).replace(/^data: /, ""));
      buf = buf.slice(i + 2);
      if (ev.type === "session") state.sessionId = ev.sessionId;
      view.handle(ev, !live);
    }
    live = true;
  }
  view.finish();
}

function setBusy(on) {
  state.busy = on;
  document.body.classList.toggle("agent-busy", on);
  document.title = on ? `● ${state.title} · ah` : "ah · Aletheia Harness";
  $("#chat-new").disabled = false;
  syncComposer();
}
function syncComposer() {
  const has = $("#chat-input").value.trim().length > 0;
  const btn = $("#chat-send");
  btn.classList.toggle("stop", state.busy && !has);
  btn.querySelector(".btn-label").textContent = state.busy ? (has ? "Steer" : "Stop") : "Send";
  $("#chat-hint").innerHTML = state.busy ? "<kbd>Enter</kbd> steers the run · <kbd>Esc</kbd> stops it" : "<kbd>Enter</kbd> send · <kbd>Shift</kbd><kbd>Enter</kbd> new line";
}

function freshLog() {
  const log = $("#chat-log");
  log.replaceChildren();
  state.view = createView(log);
  $("#chat-plan").hidden = true;
  $("#chat-stats").innerHTML = "";
  inst.reset();
  return log;
}
function showWelcome() {
  const log = freshLog();
  log.append($("#chat-empty").content.cloneNode(true));
  log.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => ((($("#chat-input").value = c.textContent), syncComposer()), $("#chat-input").focus())));
}
function setTitle(t) {
  state.title = t || "New session";
  $("#chat-title").textContent = state.title;
}

function newSession() {
  state.follow?.abort();
  state.follow = null;
  state.sessionId = null;
  localStorage.removeItem(LAST_SESSION);
  setTitle("");
  $("#chat-meta").textContent = "";
  setBusy(false);
  showWelcome();
  refreshSessions();
}

async function openSession(id) {
  state.follow?.abort();
  const ac = new AbortController();
  state.follow = ac;
  state.sessionId = id;
  localStorage.setItem(LAST_SESSION, id);
  const log = freshLog();
  const list = await api("/api/sessions", undefined, true).catch(() => []);
  const s = list.find((x) => x.id === id);
  if (!s) return newSession();
  setTitle(s.title);
  markActive();
  setBusy(s.busy);
  try {
    await consume(await fetch(`/api/sessions/${encodeURIComponent(id)}`, { headers: { "x-ah-token": TOKEN }, signal: ac.signal }), state.view, true);
  } catch (err) {
    if (err.name !== "AbortError") log.append(alertBox("Could not load session", err.message, () => openSession(id)));
  }
  if (state.follow === ac) (state.follow = null), setBusy(false), refreshSessions();
}

async function send(prompt) {
  if (state.busy) return steer(prompt);
  const ac = new AbortController();
  state.follow?.abort();
  state.follow = ac;
  if (!state.sessionId) setTitle(prompt.slice(0, 80)), $("#chat-log").querySelector(".welcome")?.remove();
  setBusy(true);
  const body = { prompt, model: $("#chat-model").value, preset: $("#chat-preset").value, mode: $("#chat-mode").value, sessionId: state.sessionId };
  const known = state.sessionId;
  try {
    const res = await fetch("/api/chat", { method: "POST", headers: { "x-ah-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
    if (!known) setTimeout(refreshSessions, 300);
    await consume(res, state.view, false);
  } catch (err) {
    if (err.name !== "AbortError") $("#chat-log").append(alertBox("Run failed", err.message)), inst.set("error");
  }
  if (state.follow === ac) state.follow = null;
  if (state.sessionId) localStorage.setItem(LAST_SESSION, state.sessionId);
  setBusy(false);
  refreshSessions();
  $("#chat-input").focus();
}

async function steer(text) {
  const log = $("#chat-log");
  log.insertAdjacentHTML("beforeend", `<div class="msg user steer pending"><div class="text">${esc(text)}</div><span class="tag">joins before the next model call</span></div>`);
  log.scrollTop = log.scrollHeight;
  try {
    await api("/api/steer", { sessionId: state.sessionId, text }, true);
  } catch (err) {
    log.append(alertBox("Could not steer", err.message));
  }
}
async function stop() {
  if (!state.busy || !state.sessionId) return;
  inst.trace("stop requested", "bad");
  await api("/api/stop", { sessionId: state.sessionId }, true).catch((err) => $("#chat-log").append(alertBox("Could not stop", err.message)));
}

// ---------- sessions sidebar ----------
function markActive() {
  document.querySelectorAll("#ses-list [data-id]").forEach((b) => b.closest("li").classList.toggle("active", b.dataset.id === state.sessionId));
}
async function refreshSessions() {
  const list = await api("/api/sessions", undefined, true).catch(() => null);
  if (!list) return;
  const ul = $("#ses-list");
  ul.innerHTML = list.length
    ? list
        .map(
          (s) =>
            `<li class="${s.id === state.sessionId ? "active" : ""}"><button type="button" class="ses" data-id="${esc(s.id)}" title="${esc(s.title)}"><span class="ses-dot ${s.busy ? "busy" : s.lastOutcome === "completed" ? "ok" : s.lastOutcome ? "bad" : ""}" aria-hidden="true"></span><span class="ses-title">${esc(s.title)}</span><span class="ses-meta">${esc(s.busy ? "running" : ago(s.updatedAt))}</span></button>${s.busy ? "" : `<button type="button" class="ses-del" data-del="${esc(s.id)}" aria-label="Delete session ${esc(s.title)}" title="Delete">×</button>`}</li>`,
        )
        .join("")
    : `<li class="ses-empty">No sessions yet</li>`;
}
$("#ses-list").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    await fetch(`/api/sessions/${encodeURIComponent(del.dataset.del)}`, { method: "DELETE", headers: { "x-ah-token": TOKEN } });
    if (del.dataset.del === state.sessionId) newSession();
    else refreshSessions();
    return;
  }
  const b = e.target.closest("[data-id]");
  if (!b) return;
  if (location.hash !== "#chat") location.hash = "chat";
  if (b.dataset.id !== state.sessionId || !state.view) openSession(b.dataset.id);
});
$("#ses-new").addEventListener("click", () => ((location.hash = "chat"), newSession(), $("#chat-input").focus()));
setInterval(() => document.visibilityState === "visible" && refreshSessions(), 5000);

// ---------- composer ----------
$("#chat-new").addEventListener("click", newSession);
$("#chat-input").addEventListener("input", syncComposer);
$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  } else if (e.key === "Escape" && state.busy) {
    e.preventDefault();
    stop();
  }
});
addEventListener("keydown", (e) => e.key === "Escape" && state.busy && !document.querySelector("dialog[open]") && location.hash.replace("#", "") in { chat: 1, "": 1 } && stop());
$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#chat-input").value.trim();
  if (!text) return state.busy ? stop() : undefined;
  $("#chat-input").value = "";
  syncComposer();
  send(text);
});
// A different model or preset starts a new session (a session keeps its model).
const restart = () => state.sessionId && !state.busy && newSession();
$("#chat-model").addEventListener("change", restart);
$("#chat-preset").addEventListener("change", async () => {
  const presets = await api("/api/presets", undefined, true).catch(() => []);
  const p = presets.find((x) => x.name === $("#chat-preset").value);
  if (p?.model && [...$("#chat-model").options].some((o) => o.value === p.model)) $("#chat-model").value = p.model;
  restart();
});

// ---------- loader ----------
let filled = false;
export async function loadConsole() {
  const [models, doc] = await Promise.all([api("/api/models?local=1&kind=chat&limit=100"), api("/api/doctor")]);
  const sel = $("#chat-model");
  const prev = sel.value;
  sel.innerHTML = models.length
    ? models.map((m) => `${m.provider}/${m.id}`).map((ref) => `<option ${(filled ? ref === prev : ref === doc.defaultModel) ? "selected" : ""}>${esc(ref)}</option>`).join("")
    : `<option value="">no local chat model found</option>`;
  if (!filled && doc.permissionMode) $("#chat-mode").value = doc.permissionMode;
  const presets = await api("/api/presets", undefined, true).catch(() => []);
  $("#preset-pick").hidden = !presets.length;
  const cur = $("#chat-preset").value;
  $("#chat-preset").innerHTML = `<option value="">no preset</option>${presets.map((p) => `<option value="${esc(p.name)}" title="${esc(p.description)}" ${p.name === cur ? "selected" : ""}>${esc(p.name)}</option>`).join("")}`;
  if (!filled) {
    filled = true;
    await refreshSessions();
    const last = localStorage.getItem(LAST_SESSION);
    if (last && document.querySelector(`#ses-list [data-id="${CSS.escape(last)}"]`)) openSession(last);
    else if (!state.view) showWelcome();
  }
}
syncComposer();
