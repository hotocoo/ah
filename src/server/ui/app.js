// web app. Vanilla JS; all dynamic text is escaped (model output is untrusted).
const TOKEN = document.querySelector('meta[name="ah-token"]').content;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = async (path, body) => {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-ah-token": TOKEN, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
  if (!res.ok) throw new Error(j.error ?? res.statusText);
  return j;
};
const num = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? "–" : Number(x).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
const ms = (x) => (x === null || x === undefined ? "–" : x < 1000 ? `${num(x)} ms` : `${num(x / 1000, 1)} s`);
const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? "–" : `${num(x * 100)}%`);
const gb = (b) => (b ? `${num(b / 1024 ** 3, 1)} GB` : "–");
const compact = (x) => (x === null || x === undefined ? "–" : Number(x).toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 }));
const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? `${num(s)}s ago` : s < 3600 ? `${num(s / 60)}m ago` : s < 86400 ? `${num(s / 3600)}h ago` : new Date(t).toLocaleDateString();
};
const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const html = (s) => {
  const t = document.createElement("template");
  t.innerHTML = s;
  return t.content;
};

// ---------- shared states: table, loading, empty, error ----------
function table(cols, rows, onClick, empty = "No data yet.") {
  const head = cols.map((c) => `<th class="${c.num ? "num" : ""}" scope="col">${esc(c.label)}</th>`).join("");
  const body = rows
    .map((r, i) => `<tr data-i="${i}" class="${onClick ? "click" : ""}"${onClick ? ' tabindex="0"' : ""}>${cols.map((c) => `<td class="${c.num ? "num" : c.clip ? "clip" : ""}"${c.clip && c.get ? ` title="${esc(c.get(r))}"` : ""}>${c.html ? c.html(r) : esc(c.get(r))}</td>`).join("")}</tr>`)
    .join("");
  const el = document.createElement("div");
  el.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="empty-cell">${esc(empty)}</td></tr>`}</tbody></table>`;
  if (onClick)
    el.querySelectorAll("tbody tr[data-i]").forEach((tr) => {
      const pick = () => {
        el.querySelectorAll("tr.selected").forEach((x) => x.classList.remove("selected"));
        tr.classList.add("selected");
        onClick(rows[Number(tr.dataset.i)]);
      };
      tr.addEventListener("click", pick);
      tr.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()));
    });
  return el;
}
const mount = (sel, node) => {
  const t = $(sel);
  t.replaceChildren(node);
};
const outcome = (o) => `<span class="${o === "completed" ? "ok" : o ? "bad" : "muted"}">${esc(o ?? "running")}</span>`;
// Skeletons only on first paint of a container, so background refreshes never flash.
const shimmer = (...sels) =>
  sels.forEach((s) => {
    const el = $(s);
    if (el && !el.dataset.loaded) el.innerHTML = `<div class="sk sk-line" style="width:40%"></div><div class="sk sk-block"></div><div class="sk sk-line" style="width:70%"></div>`;
  });
const loaded = (...sels) => sels.forEach((s) => $(s) && ($(s).dataset.loaded = "1"));
const alertBox = (title, message, retry) => {
  const el = html(`<div class="alert" role="alert"><span class="glyph" aria-hidden="true">!</span><div><strong>${esc(title)}</strong><p>${esc(message)}</p></div>${retry ? '<button type="button" class="ghost">Retry</button>' : ""}</div>`).firstElementChild;
  if (retry) el.querySelector("button").addEventListener("click", retry);
  return el;
};

// ---------- tabs: roving focus, hash state, view transitions ----------
const loaders = {};
const TABS = $$('[role="tab"]').map((b) => b.dataset.tab);
async function openTab(name) {
  const sec = $(`#tab-${name}`);
  const fn = loaders[name];
  if (!fn) return;
  sec.querySelector(":scope > .page-alert")?.remove();
  sec.setAttribute("aria-busy", "true");
  try {
    await fn();
  } catch (err) {
    const box = alertBox(`Could not load ${name}`, err.message, () => openTab(name));
    box.classList.add("page-alert");
    sec.querySelector(".page-head")?.after(box) ?? sec.prepend(box);
  } finally {
    sec.removeAttribute("aria-busy");
  }
}
function select(name, { focus = false } = {}) {
  if (!TABS.includes(name)) name = "chat";
  const current = $(".tab.active");
  const next = $(`#tab-${name}`);
  const swap = () => {
    $$('[role="tab"]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    $$(".tab").forEach((t) => {
      const on = t === next;
      t.classList.toggle("active", on);
      t.hidden = !on;
    });
    if (current !== next) {
      next.classList.remove("entering");
      next.querySelectorAll(".cell, .kpis > *").forEach((c, i) => c.style.setProperty("--i", i));
      void next.offsetWidth;
      next.classList.add("entering");
    }
  };
  if (current !== next && document.startViewTransition && !reducedMotion()) document.startViewTransition(swap);
  else swap();
  if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
  openTab(name);
}
$$('[role="tab"]').forEach((b, i, all) => {
  b.addEventListener("click", () => select(b.dataset.tab));
  b.addEventListener("keydown", (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (step) {
      e.preventDefault();
      select(all[(i + step + all.length) % all.length].dataset.tab, { focus: true });
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      select(all[e.key === "Home" ? 0 : all.length - 1].dataset.tab, { focus: true });
    }
  });
});
addEventListener("hashchange", () => select(location.hash.slice(1)));

// Pointer-tracked sheen on cells; one rAF-throttled listener for the whole page.
let sheenFrame = 0;
document.addEventListener("pointermove", (e) => {
  if (sheenFrame || e.pointerType !== "mouse") return;
  sheenFrame = requestAnimationFrame(() => {
    sheenFrame = 0;
    const cell = e.target.closest?.(".cell");
    if (!cell) return;
    const r = cell.getBoundingClientRect();
    cell.style.setProperty("--mx", `${e.clientX - r.left}px`);
    cell.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
});

// ---------- overview ----------
function barChart(el, points) {
  if (!points.length) return (el.innerHTML = `<div class="empty"><strong>No runs recorded yet.</strong><span>Run a task in the console and it appears here within seconds.</span></div>`);
  const W = 640, H = 220, P = 28;
  const max = Math.max(...points.map((p) => p.runs), 1);
  const bw = (W - P * 2) / points.length;
  const grid = [0.25, 0.5, 0.75, 1].map((f) => `<line class="grid" x1="${P}" x2="${W - P}" y1="${H - P - (H - P * 2) * f}" y2="${H - P - (H - P * 2) * f}"/>`).join("");
  const bars = points
    .map((p, i) => {
      const h = ((H - P * 2) * p.runs) / max;
      const w = Math.max(1, Math.min(bw - 2, 44));
      return `<rect class="bar" style="--i:${i}" rx="2" x="${P + i * bw + (bw - w) / 2}" y="${H - P - h}" width="${w}" height="${h}"><title>${esc(new Date(p.bucket).toLocaleString())}: ${p.runs} runs, ${num(p.tokens)} tokens</title></rect>`;
    })
    .join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Runs per hour, peak ${max}"><defs><linearGradient id="bar-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="oklch(91% 0.075 92)"/><stop offset="0.45" stop-color="oklch(80% 0.115 84)"/><stop offset="1" stop-color="oklch(60% 0.105 70 / 0.5)"/></linearGradient></defs>${grid}<line class="axis" x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}"/>${bars}<text x="${P}" y="${H - 8}">${esc(new Date(points[0].bucket).toLocaleString())}</text><text x="${W - P}" y="${H - 8}" text-anchor="end">${esc(new Date(points.at(-1).bucket).toLocaleString())}</text><text x="${P}" y="14">peak ${max}/h</text></svg>`;
}
function distRows(el, rows) {
  const max = Math.max(...rows.map((r) => r.d?.p95 ?? 0), 1);
  el.innerHTML =
    rows
      .map((r) => {
        const p50 = clamp01((r.d?.p50 ?? 0) / max), p95 = clamp01((r.d?.p95 ?? 0) / max);
        return `<div class="row"><div class="row-head"><span>${esc(r.label)}</span><span class="num">${esc(r.fmt(r.d?.p50))} · ${esc(r.fmt(r.d?.p95))}</span></div><div class="track"><div class="p95" style="--v:${p95}"></div><div class="fill" style="--v:${p50}"></div></div></div>`;
      })
      .join("") + `<p class="legend">Bright bar: median. Faint bar: p95. Scaled per page to the slowest p95.</p>`;
}
function countUp(el, to) {
  if (reducedMotion() || !Number.isFinite(to) || to <= 0) return (el.textContent = num(to));
  const t0 = performance.now(), dur = 900;
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = num(Math.round(to * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
loaders.overview = async () => {
  shimmer("#chart-runs", "#latency", "#by-model", "#by-tool");
  if (!$("#kpis").dataset.loaded) $("#kpis").innerHTML = `<div class="sk" style="height:190px;border-radius:18px"></div><div class="sk" style="height:190px;border-radius:18px"></div>`;
  const [s, series, models, tools] = await Promise.all([api("/api/telemetry/summary"), api("/api/telemetry/timeseries?bucket=3600000"), api("/api/telemetry/models"), api("/api/telemetry/tools")]);
  const t = s.totals;
  const k = (v, l) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;
  const rate = t.runs ? t.completed / t.runs : null;
  $("#kpis").innerHTML =
    `<div class="kpi-hero"><div class="l">runs completed</div><div class="v"><span id="kpi-hero-n">${num(t.completed)}</span><small> / ${esc(num(t.runs))}</small></div><div class="foot">${
      t.runs ? `<span class="tag gold">${esc(pct(rate))} completion</span><span>across ${esc(num(models.length))} model${models.length === 1 ? "" : "s"}</span>` : `<span>No runs yet.</span><button type="button" class="ghost" data-go="chat">Open console</button>`
    }</div></div>` +
    `<div class="strip">${k(compact((t.input_tokens ?? 0) + (t.output_tokens ?? 0)), "tokens")}${k(pct(t.cacheHitRate), "prompt cache hit")}${k(pct(t.toolErrorRate), "tool error rate")}${k(ms(s.ttftMs.p50), "TTFT p50")}${k(num(s.tokensPerSec.p50, 1), "decode tok/s p50")}</div>`;
  $("#kpis").querySelector("[data-go]")?.addEventListener("click", () => select("chat"));
  if (!$("#kpis").dataset.loaded) countUp($("#kpi-hero-n"), t.completed ?? 0);
  barChart($("#chart-runs"), series);
  distRows($("#latency"), [
    { label: "turn latency", d: s.turnLatencyMs, fmt: ms },
    { label: "TTFT", d: s.ttftMs, fmt: ms },
    { label: "run wall time", d: s.runWallMs, fmt: ms },
    { label: "context tokens", d: s.contextTokens, fmt: (x) => num(x) },
    { label: "turns per run", d: s.runTurns, fmt: (x) => num(x, 1) },
  ]);
  mount("#by-model", table([
    { label: "model", get: (r) => `${r.provider}/${r.model}`, clip: 1 },
    { label: "runs", get: (r) => r.runs, num: 1 },
    { label: "done", get: (r) => pct(r.completed / r.runs), num: 1 },
    { label: "avg wall", get: (r) => ms(r.avg_wall_ms), num: 1 },
    { label: "avg TTFT", get: (r) => ms(r.avg_ttft_ms), num: 1 },
    { label: "tokens", get: (r) => compact((r.input_tokens ?? 0) + (r.output_tokens ?? 0)), num: 1 },
    { label: "cost", html: (r) => (r.cost_usd ? esc(`$${num(r.cost_usd, 4)}`) : '<span class="tag gold">local</span>'), num: 1 },
  ], models, null, "No model has run yet."));
  mount("#by-tool", table([
    { label: "tool", get: (r) => r.name },
    { label: "calls", get: (r) => r.calls, num: 1 },
    { label: "errors", html: (r) => `<span class="${r.errorRate > 0.2 ? "bad" : ""}">${esc(pct(r.errorRate))}</span>`, num: 1 },
    { label: "denied", get: (r) => r.denied, num: 1 },
    { label: "p50", get: (r) => ms(r.durationMs.p50), num: 1 },
    { label: "p95", get: (r) => ms(r.durationMs.p95), num: 1 },
  ], tools, null, "No tool calls recorded."));
  loaded("#kpis", "#chart-runs", "#latency", "#by-model", "#by-tool");
};

// ---------- runs ----------
loaders.runs = async () => {
  shimmer("#runs");
  const runs = await api("/api/telemetry/runs?limit=200");
  mount("#runs", table([
    { label: "started", get: (r) => ago(r.started_at) },
    { label: "model", get: (r) => r.model, clip: 1 },
    { label: "outcome", html: (r) => outcome(r.outcome) },
    { label: "turns", get: (r) => r.turns, num: 1 },
    { label: "tools", get: (r) => r.tool_calls, num: 1 },
    { label: "wall", get: (r) => ms(r.wall_ms), num: 1 },
    { label: "bench", html: (r) => (r.bench_task_id ? `<span class="tag">${esc(r.bench_task_id)}#${esc(r.bench_trial)}</span>` : "") },
  ], runs, showRun, "No runs yet. Tasks from the console land here."));
  loaded("#runs");
};
async function withDetail(sel, fn) {
  const box = $(sel);
  box.innerHTML = `<div class="sk sk-line" style="width:55%"></div><div class="sk sk-block"></div>`;
  try {
    await fn(box);
  } catch (err) {
    box.replaceChildren(alertBox("Could not load detail", err.message, () => withDetail(sel, fn)));
  }
}
function showRun(r) {
  return withDetail("#run-detail", async () => {
    const d = await api(`/api/telemetry/run/${encodeURIComponent(r.run_id)}`);
    const el = document.createElement("div");
    el.innerHTML = `<dl class="kv"><dt>run</dt><dd>${esc(r.run_id)}</dd><dt>model</dt><dd>${esc(r.provider)}/${esc(r.model)}</dd><dt>outcome</dt><dd>${outcome(r.outcome)}</dd><dt>context window</dt><dd>${num(r.context_window)}</dd><dt>tokens in/out</dt><dd>${num(r.input_tokens)} / ${num(r.output_tokens)} (cache ${num(r.cache_read_tokens)})</dd><dt>GPU util avg</dt><dd>${r.gpu_util_avg === null ? "–" : `${num(r.gpu_util_avg)}%`}</dd></dl><p class="prompt">${esc(r.prompt)}</p><h3>Turns</h3>`;
    el.append(table([
      { label: "#", get: (t) => t.turn },
      { label: "latency", get: (t) => ms(t.latency_ms), num: 1 },
      { label: "TTFT", get: (t) => ms(t.ttft_ms), num: 1 },
      { label: "in", get: (t) => num(t.input_tokens), num: 1 },
      { label: "out", get: (t) => num(t.output_tokens), num: 1 },
      { label: "prefill t/s", get: (t) => num(t.prefill_tps, 1), num: 1 },
      { label: "decode t/s", get: (t) => num(t.decode_tps ?? t.tokens_per_sec, 1), num: 1 },
      { label: "stop", get: (t) => t.stop_reason },
    ], d.turns));
    el.append(Object.assign(document.createElement("h3"), { textContent: "Tool calls" }), table([
      { label: "tool", get: (t) => t.name },
      { label: "ok", html: (t) => (t.is_error ? `<span class="bad">✗ error</span>` : `<span class="ok">✓ ok</span>`) },
      { label: "time", get: (t) => ms(t.duration_ms), num: 1 },
      { label: "input", get: (t) => (t.input ?? "").slice(0, 80), clip: 1 },
    ], d.tools, null, "This run made no tool calls."));
    mount("#run-detail", el);
  });
}

// ---------- bench ----------
loaders.bench = async () => {
  shimmer("#bench-list");
  const runs = await api("/api/bench");
  mount("#bench-list", table([
    { label: "started", get: (r) => new Date(r.started_at).toLocaleString() },
    { label: "model", get: (r) => r.model, clip: 1 },
    { label: "trials", get: (r) => r.trials, num: 1 },
  ], runs, showBench, "No benchmark runs. Try: ah bench run --model mock/scripted"));
  loaded("#bench-list");
};
function showBench(r) {
  return withDetail("#bench-detail", async () => {
    const { summary } = await api(`/api/bench/${encodeURIComponent(r.id)}`);
    if (!summary) return mount("#bench-detail", Object.assign(document.createElement("p"), { className: "empty-note", textContent: "Still running or no results." }));
    const o = summary.overall;
    const el = document.createElement("div");
    el.innerHTML = `<div class="kpi-hero"><div class="l">pass@1</div><div class="v">${esc(pct(o.meanPassAt1))}</div><div class="foot"><span class="tag gold">${esc(`${o.passes}/${o.trials}`)} trials</span><span>95% CI ${esc(pct(o.wilson.low))} to ${esc(pct(o.wilson.high))}</span></div></div><div class="strip" style="margin-top:14px">${[
      [pct(o.meanPassHatK), `pass^${summary.k}`],
      [`${o.solvedAny}/${summary.tasks.length}`, "solved ≥1×"],
      [num(o.meanDecodeTps, 1), "decode tok/s"],
      [ms(o.p50WallMs), "p50 wall"],
    ].map(([v, l]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("")}</div><h3>Tasks</h3>`;
    el.append(table([
      { label: "task", get: (t) => t.taskId, clip: 1 },
      { label: "lang", get: (t) => t.language },
      { label: "pass", html: (t) => `<span class="${t.passes === t.n ? "ok" : t.passes ? "warn" : "bad"}">${t.passes}/${t.n}</span>`, num: 1 },
      { label: "pass@1", get: (t) => pct(t.passAt1), num: 1 },
      { label: "time", get: (t) => ms(t.meanWallMs), num: 1 },
      { label: "turns", get: (t) => num(t.meanTurns, 1), num: 1 },
      { label: "failures", get: (t) => Object.entries(t.failReasons).map(([k, v]) => `${k}×${v}`).join(" ") },
    ], summary.tasks));
    mount("#bench-detail", el);
  });
}

// ---------- models ----------
let mTimer;
loaders.models = async () => {
  shimmer("#models");
  const q = new URLSearchParams({ q: $("#m-q").value, kind: $("#m-kind").value, limit: "300", ...($("#m-local").checked ? { local: "1" } : {}), ...($("#m-tools").checked ? { tools: "1" } : {}) });
  const ms_ = await api(`/api/models?${q}`);
  $("#m-count").textContent = `${num(ms_.length)} model${ms_.length === 1 ? "" : "s"}`;
  mount("#models", table([
    { label: "model", get: (m) => `${m.provider}/${m.id}`, html: (m) => `${m.local ? '<span class="tag gold">local</span> ' : ""}${esc(m.provider)}/${esc(m.id)}`, clip: 1 },
    { label: "kinds", get: (m) => m.kinds.join(", ") },
    { label: "context", get: (m) => compact(m.contextWindow), num: 1 },
    { label: "tools", html: (m) => (m.toolCall ? '<span class="ok">✓ yes</span>' : '<span class="muted">no</span>') },
    { label: "in → out", get: (m) => `${m.inputModalities.join("+")} → ${m.outputModalities.join("+")}` },
    { label: "quant", get: (m) => m.local?.quantization ?? "" },
    { label: "size", get: (m) => gb(m.local?.sizeBytes), num: 1 },
    { label: "$ in/out per M", get: (m) => (m.cost?.input !== undefined ? `${m.cost.input} / ${m.cost.output}` : ""), num: 1 },
  ], ms_, null, "No models match these filters."));
  loaded("#models");
};
["#m-q", "#m-kind", "#m-local", "#m-tools"].forEach((s) => $(s).addEventListener("input", () => (clearTimeout(mTimer), (mTimer = setTimeout(() => openTab("models"), 250)))));

// ---------- chat: transcript + live instrument ----------
let sessionId = null;
let modelsFilled = false;
async function fillModels() {
  const [ms_, doc] = await Promise.all([api("/api/models?local=1&kind=chat&limit=100"), api("/api/doctor")]);
  const sel = $("#chat-model");
  const prev = sel.value;
  sel.innerHTML = ms_.length
    ? ms_.map((m) => { const ref = `${m.provider}/${m.id}`; return `<option ${(modelsFilled ? ref === prev : ref === doc.defaultModel) ? "selected" : ""}>${esc(ref)}</option>`; }).join("")
    : `<option value="">no local chat model found</option>`;
  modelsFilled = true;
}
loaders.chat = () => fillModels();

const inst = {
  set(state) {
    const el = $("#run-state");
    el.dataset.state = state;
    el.textContent = state;
  },
  reset() {
    this.set("idle");
    ["#run-turn", "#run-ttft", "#run-tps", "#run-tools"].forEach((s) => ($(s).textContent = "–"));
    this.ctx(0, 0);
    $("#run-trace").innerHTML = `<li class="trace-empty">Events stream here while a task runs.</li>`;
  },
  ctx(used, window) {
    const f = window ? clamp01(used / window) : 0;
    const m = $("#run-ctx");
    m.querySelector("span").style.setProperty("--v", f);
    m.classList.toggle("hot", f > 0.8);
    m.setAttribute("aria-valuenow", String(Math.round(f * 100)));
    $("#run-ctx-label").textContent = window ? `${compact(used)} / ${compact(window)}` : "–";
  },
  trace(text, kind = "") {
    const list = $("#run-trace");
    list.querySelector(".trace-empty")?.remove();
    const li = document.createElement("li");
    li.className = kind ? `k-${kind}` : "";
    li.innerHTML = `<time>${esc(new Date().toLocaleTimeString())}</time>${esc(text)}`;
    list.append(li);
    list.scrollTop = list.scrollHeight;
  },
};
let ctxWindow = 0;

function showWelcome() {
  const log = $("#chat-log");
  log.replaceChildren($("#chat-empty").content.cloneNode(true));
  log.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      $("#chat-input").value = c.textContent;
      $("#chat-input").focus();
    }),
  );
}
$("#chat-new").addEventListener("click", () => {
  sessionId = null;
  showWelcome();
  $("#chat-meta").textContent = "";
  inst.reset();
});
$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
});

$("#chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = $("#chat-input").value.trim();
  if (!prompt) return;
  const log = $("#chat-log");
  const btn = $("#chat-form button[type=submit]");
  if (btn.disabled) return;
  btn.disabled = true;
  btn.querySelector(".btn-label").textContent = "Running";
  $("#chat-input").value = "";
  log.querySelector(".welcome")?.remove();
  log.insertAdjacentHTML("beforeend", `<div class="msg user"><div class="text">${esc(prompt)}</div></div>`);
  const msg = document.createElement("div");
  msg.className = "msg agent streaming";
  log.append(msg);
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  const follow = (was) => was && (log.scrollTop = log.scrollHeight);
  follow(true);
  let textEl = null;
  let thinkEl = null;
  let toolCount = 0;
  const tools = new Map();
  inst.reset();
  inst.set("thinking");
  inst.trace("task submitted", "gold");
  $("#run-tools").textContent = "0";
  try {
    const res = await fetch("/api/chat", { method: "POST", headers: { "x-ah-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify({ prompt, model: $("#chat-model").value, sessionId }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status} ${res.statusText}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).replace(/^data: /, "");
        buf = buf.slice(i + 2);
        const ev = JSON.parse(line);
        const was = nearBottom();
        if (ev.type === "session") {
          sessionId = ev.sessionId;
          ctxWindow = ev.contextWindow ?? 0;
          $("#chat-meta").textContent = `${ev.model} · context ${compact(ev.contextWindow)}`;
          inst.ctx(0, ctxWindow);
        } else if (ev.type === "turn_start") {
          $("#run-turn").textContent = String(ev.turn);
          inst.ctx(ev.contextTokens, ctxWindow);
          inst.set("thinking");
          inst.trace(`turn ${ev.turn} · ${compact(ev.contextTokens)} ctx tokens`);
        } else if (ev.type === "first_token") {
          $("#run-ttft").textContent = ms(ev.ttftMs);
        } else if (ev.type === "thinking_delta") {
          if (!thinkEl) {
            const d = html(`<details class="thinking"><summary>Reasoning</summary><div></div></details>`).firstElementChild;
            msg.append(d);
            thinkEl = d.querySelector("div");
          }
          thinkEl.textContent += ev.text;
        } else if (ev.type === "text_delta") {
          thinkEl = null;
          if (!textEl) msg.append((textEl = Object.assign(document.createElement("div"), { className: "text" })));
          textEl.textContent += ev.text;
        } else if (ev.type === "model_response") {
          if (ev.outputTokensPerSec) $("#run-tps").textContent = `${num(ev.outputTokensPerSec, 1)}/s`;
          inst.trace(`response · ${num(ev.usage?.outputTokens)} out · ${ms(ev.latencyMs)}`);
        } else if (ev.type === "tool_start") {
          textEl = null;
          thinkEl = null;
          toolCount += 1;
          $("#run-tools").textContent = String(toolCount);
          inst.set("tool");
          const t = html(`<div class="tool"><span class="dot" aria-hidden="true"></span><span class="sum">${esc(ev.summary)}</span><span class="dur">running</span></div>`).firstElementChild;
          tools.set(ev.id, t);
          msg.append(t);
          inst.trace(`${ev.name} started`, "gold");
        } else if (ev.type === "tool_end") {
          const t = tools.get(ev.id);
          if (t) {
            t.classList.add(ev.isError ? "err" : "done");
            t.querySelector(".dur").textContent = `${ev.isError ? "✗" : "✓"} ${ms(ev.durationMs)}`;
            if (ev.isError) t.insertAdjacentHTML("beforeend", `<span class="note">${esc(ev.preview.split("\n")[0].slice(0, 160))}</span>`);
          }
          inst.trace(`${ev.name} ${ev.denied ? "denied" : ev.isError ? "failed" : "ok"} · ${ms(ev.durationMs)}`, ev.isError ? "bad" : "ok");
          inst.set("thinking");
        } else if (ev.type === "retry") {
          inst.trace(`retry ${ev.attempt} · ${ev.reason} · ${ms(ev.delayMs)}`, "bad");
        } else if (ev.type === "compaction") {
          inst.trace(`compacted ${compact(ev.beforeTokens)} to ${compact(ev.afterTokens)} (${ev.strategy})`, "gold");
          inst.ctx(ev.afterTokens, ctxWindow);
        } else if (ev.type === "tool_calls_recovered") {
          inst.trace(`recovered ${ev.count} tool call${ev.count === 1 ? "" : "s"} from ${ev.formats.join(", ")}`);
        } else if (ev.type === "run_end") {
          const r = ev.result;
          const chip = (v, cls = "") => `<span class="tag ${cls}">${esc(v)}</span>`;
          msg.insertAdjacentHTML("beforeend", `<div class="stats">${chip(r.outcome, r.outcome === "completed" ? "gold" : "")}${chip(`${r.turns} turns`)}${chip(`${r.toolCalls} tools`)}${chip(ms(r.wallMs))}${chip(`${num(r.usage.inputTokens)} in / ${num(r.usage.outputTokens)} out`)}${r.changedFiles.length ? chip(`changed ${r.changedFiles.join(", ")}`) : ""}</div>`);
          inst.set(r.outcome === "completed" ? "done" : "error");
          inst.trace(`run ${r.outcome} · ${ms(r.wallMs)}`, r.outcome === "completed" ? "ok" : "bad");
        } else if (ev.type === "error") {
          msg.append(alertBox("Agent error", ev.message));
          inst.set("error");
          inst.trace(ev.message, "bad");
        }
        follow(was);
      }
    }
  } catch (err) {
    msg.append(alertBox("Run failed", err.message));
    inst.set("error");
    inst.trace(err.message, "bad");
  } finally {
    msg.classList.remove("streaming");
    if (!msg.childElementCount) msg.remove();
    btn.disabled = false;
    btn.querySelector(".btn-label").textContent = "Run task";
    $("#chat-input").focus();
  }
});

// ---------- studio ----------
function mediaForm(formSel, outSel, run) {
  $(formSel).addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $(outSel);
    const btn = e.submitter ?? $(`${formSel} button[type=submit]`);
    out.innerHTML = `<div class="skeleton"><span>Rendering</span></div>`;
    btn.disabled = true;
    try {
      out.replaceChildren(await run());
    } catch (err) {
      out.replaceChildren(alertBox("Generation failed", err.message, () => $(formSel).requestSubmit()));
    } finally {
      btn.disabled = false;
    }
  });
}
mediaForm("#img-form", "#img-out", async () => {
  const r = await api("/api/image", { prompt: $("#img-prompt").value });
  return html(r.images.map((im) => `<img alt="generated image" src="data:${esc(im.mediaType)};base64,${esc(im.data)}">`).join("") + `<p class="caption">${esc(r.backend)} · ${ms(r.ms)}</p>`);
});
mediaForm("#m3d-form", "#m3d-out", async () => {
  const r = await api("/api/3d", { prompt: $("#m3d-prompt").value });
  const blob = new Blob([Uint8Array.from(atob(r.glb), (c) => c.charCodeAt(0))], { type: "model/gltf-binary" });
  return html(`<img alt="3D preview" src="data:image/png;base64,${esc(r.preview)}"><p class="caption">${esc(r.model)} · ${r.scene.objects.length} parts · ${num(r.triangles)} triangles · ${ms(r.ms)} · <a download="model.glb" href="${URL.createObjectURL(blob)}">download .glb</a></p>`);
});

// ---------- system ----------
const gauge = (label, value, f) => `<div class="gauge"><div class="ctx-head"><span>${esc(label)}</span><span class="num">${esc(value)}</span></div><div class="meter${f > 0.85 ? " hot" : ""}"><span style="--v:${clamp01(f)}"></span></div></div>`;
loaders.system = async () => {
  shimmer("#runtimes", "#hardware");
  const d = await api("/api/doctor");
  $("#runtimes").innerHTML = d.runtimes.length
    ? d.runtimes.map((r) => `<div class="runtime"><div class="runtime-head"><strong>${esc(r.key)}</strong><span class="tag gold">${esc(r.kind)} ${esc(r.version ?? "")}</span></div><span class="runtime-url">${esc(r.baseURL)}</span><div class="runtime-models">${r.models.length ? r.models.map((m) => `<span class="tag">${esc(m)}</span>`).join("") : '<span class="muted">no models loaded</span>'}</div></div>`).join("")
    : `<div class="empty"><strong>No local runtimes discovered.</strong><span>Start Ollama, llama.cpp, LM Studio or vLLM and reopen this tab.</span></div>`;
  const h = d.hardware;
  const used = h.memTotalBytes && h.memFreeBytes !== undefined ? h.memTotalBytes - h.memFreeBytes : 0;
  $("#hardware").innerHTML =
    gauge("GPU utilisation", h.gpuUtilPct === null || h.gpuUtilPct === undefined ? "–" : `${h.gpuUtilPct}%`, (h.gpuUtilPct ?? 0) / 100) +
    gauge("memory in use", `${gb(used)} / ${gb(h.memTotalBytes)}`, h.memTotalBytes ? used / h.memTotalBytes : 0) +
    `<dl class="kv"><dt>GPU</dt><dd>${esc(h.gpuName ?? "–")}</dd><dt>GPU allocated</dt><dd>${gb(h.gpuAllocBytes)}</dd><dt>CPU threads</dt><dd>${esc(h.cpuCount)}</dd><dt>load (1m)</dt><dd>${num(h.load1, 2)}</dd><dt>workspace</dt><dd>${esc(d.root)}</dd><dt>catalog</dt><dd>${num(d.catalogSize)} models</dd></dl>`;
  loaded("#runtimes", "#hardware");
};

// ---------- live hardware ----------
async function pollHw() {
  const box = $(".hw");
  try {
    const h = await api("/api/hardware");
    box.classList.remove("offline");
    $("#hw-pill").textContent = `GPU ${h.gpuUtilPct ?? "–"}% · ${gb(h.gpuAllocBytes)} · ${num(h.load1, 1)}`;
    $(".hw").title = `GPU ${h.gpuUtilPct ?? "–"}% utilised · ${gb(h.gpuAllocBytes)} allocated · load ${num(h.load1, 2)} (1m)`;
    $("#hw-meter").style.setProperty("--v", clamp01((h.gpuUtilPct ?? 0) / 100));
  } catch {
    box.classList.add("offline");
    $("#hw-pill").textContent = "offline";
    $("#hw-meter").style.setProperty("--v", 0);
  }
}
pollHw();
setInterval(pollHw, 3000);
showWelcome();
select(location.hash.slice(1) || "chat");
