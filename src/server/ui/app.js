// ah web app. Vanilla JS; all dynamic text is escaped (model output is untrusted).
const TOKEN = document.querySelector('meta[name="ah-token"]').content;
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = async (path, body) => {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-ah-token": TOKEN, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? res.statusText);
  return j;
};
const num = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? "–" : Number(x).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
const ms = (x) => (x === null || x === undefined ? "–" : x < 1000 ? `${num(x)} ms` : `${num(x / 1000, 1)} s`);
const pct = (x) => (x === null || x === undefined ? "–" : `${num(x * 100)}%`);
const gb = (b) => (b ? `${num(b / 1024 ** 3, 1)} GB` : "–");
const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? `${num(s)}s ago` : s < 3600 ? `${num(s / 60)}m ago` : s < 86400 ? `${num(s / 3600)}h ago` : new Date(t).toLocaleDateString();
};
function table(cols, rows, onClick) {
  const head = cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("");
  const body = rows
    .map((r, i) => `<tr data-i="${i}" class="${onClick ? "click" : ""}">${cols.map((c) => `<td class="${c.num ? "num" : c.clip ? "clip" : ""}"${c.clip && c.get ? ` title="${esc(c.get(r))}"` : ""}>${c.html ? c.html(r) : esc(c.get(r))}</td>`).join("")}</tr>`)
    .join("");
  const el = document.createElement("div");
  el.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="muted">No data yet.</td></tr>`}</tbody></table>`;
  if (onClick) el.querySelectorAll("tbody tr[data-i]").forEach((tr) => tr.addEventListener("click", () => onClick(rows[Number(tr.dataset.i)])));
  return el;
}
const mount = (sel, node) => {
  const t = $(sel);
  t.replaceChildren(node);
};
const outcome = (o) => `<span class="${o === "completed" ? "ok" : o ? "bad" : "muted"}">${esc(o ?? "running")}</span>`;

// ---------- tabs ----------
const loaders = {};
document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${b.dataset.tab}`));
    loaders[b.dataset.tab]?.();
  }),
);

// ---------- overview ----------
function barChart(el, points) {
  if (!points.length) return (el.innerHTML = `<p class="muted">No runs yet.</p>`);
  const W = 600, H = 200, P = 24;
  const max = Math.max(...points.map((p) => p.runs), 1);
  const bw = (W - P * 2) / points.length;
  const bars = points
    .map((p, i) => {
      const h = ((H - P * 2) * p.runs) / max;
      return `<rect class="bar" x="${P + i * bw + 1}" y="${H - P - h}" width="${Math.max(1, bw - 2)}" height="${h}"><title>${esc(new Date(p.bucket).toLocaleString())}: ${p.runs} runs, ${num(p.tokens)} tokens</title></rect>`;
    })
    .join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Runs per hour"><line class="axis" x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}"/>${bars}<text x="${P}" y="${H - 6}">${esc(new Date(points[0].bucket).toLocaleString())}</text><text x="${W - P}" y="${H - 6}" text-anchor="end">${esc(new Date(points.at(-1).bucket).toLocaleString())}</text><text x="${P}" y="14">max ${max}/h</text></svg>`;
}
function distRows(el, rows) {
  const max = Math.max(...rows.map((r) => r.d?.p95 ?? 0), 1);
  el.innerHTML = rows
    .map(
      (r) =>
        `<div class="row"><span>${esc(r.label)}</span><div class="track"><div class="fill" style="width:${((r.d?.p50 ?? 0) / max) * 100}%"></div></div><span class="num muted">${r.fmt(r.d?.p50)} / ${r.fmt(r.d?.p95)}</span></div>`,
    )
    .join("") + `<p class="muted" style="font-size:12px;margin:4px 0 0">bars: median; numbers: p50 / p95</p>`;
}
loaders.overview = async () => {
  const [s, series, models, tools] = await Promise.all([api("/api/telemetry/summary"), api("/api/telemetry/timeseries?bucket=3600000"), api("/api/telemetry/models"), api("/api/telemetry/tools")]);
  const t = s.totals;
  const k = (v, l, hero) => `<div class="kpi${hero ? " hero" : ""}"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`;
  $("#kpis").innerHTML =
    k(`${num(t.completed)}/${num(t.runs)}`, "runs completed", true) +
    k(num((t.input_tokens ?? 0) + (t.output_tokens ?? 0)), "tokens") +
    k(pct(t.cacheHitRate), "prompt cache hit") +
    k(pct(t.toolErrorRate), "tool error rate") +
    k(ms(s.ttftMs.p50), "TTFT p50") +
    k(num(s.tokensPerSec.p50, 1), "decode tok/s p50");
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
    { label: "done", html: (r) => pct(r.completed / r.runs), num: 1 },
    { label: "avg wall", get: (r) => ms(r.avg_wall_ms), num: 1 },
    { label: "avg TTFT", get: (r) => ms(r.avg_ttft_ms), num: 1 },
    { label: "tokens", get: (r) => num((r.input_tokens ?? 0) + (r.output_tokens ?? 0)), num: 1 },
    { label: "cost", get: (r) => (r.cost_usd ? `$${num(r.cost_usd, 4)}` : "local"), num: 1 },
  ], models));
  mount("#by-tool", table([
    { label: "tool", get: (r) => r.name },
    { label: "calls", get: (r) => r.calls, num: 1 },
    { label: "errors", html: (r) => `<span class="${r.errorRate > 0.2 ? "bad" : ""}">${pct(r.errorRate)}</span>`, num: 1 },
    { label: "denied", get: (r) => r.denied, num: 1 },
    { label: "p50", get: (r) => ms(r.durationMs.p50), num: 1 },
    { label: "p95", get: (r) => ms(r.durationMs.p95), num: 1 },
  ], tools));
};

// ---------- runs ----------
loaders.runs = async () => {
  const runs = await api("/api/telemetry/runs?limit=200");
  mount("#runs", table([
    { label: "started", get: (r) => ago(r.started_at) },
    { label: "model", get: (r) => r.model, clip: 1 },
    { label: "outcome", html: (r) => outcome(r.outcome) },
    { label: "turns", get: (r) => r.turns, num: 1 },
    { label: "tools", get: (r) => r.tool_calls, num: 1 },
    { label: "wall", get: (r) => ms(r.wall_ms), num: 1 },
    { label: "bench", html: (r) => (r.bench_task_id ? `<span class="tag">${esc(r.bench_task_id)}#${esc(r.bench_trial)}</span>` : "") },
  ], runs, showRun));
};
async function showRun(r) {
  const d = await api(`/api/telemetry/run/${encodeURIComponent(r.run_id)}`);
  const el = document.createElement("div");
  el.innerHTML = `<dl class="kv"><dt>run</dt><dd>${esc(r.run_id)}</dd><dt>model</dt><dd>${esc(r.provider)}/${esc(r.model)}</dd><dt>context window</dt><dd>${num(r.context_window)}</dd><dt>tokens in/out</dt><dd>${num(r.input_tokens)} / ${num(r.output_tokens)} (cache ${num(r.cache_read_tokens)})</dd><dt>GPU util avg</dt><dd>${r.gpu_util_avg === null ? "–" : `${num(r.gpu_util_avg)}%`}</dd><dt>prompt</dt><dd>${esc(r.prompt)}</dd></dl><h2 style="margin-top:16px">Turns</h2>`;
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
  const h = document.createElement("h2");
  h.textContent = "Tool calls";
  h.style.marginTop = "16px";
  el.append(h, table([
    { label: "tool", get: (t) => t.name },
    { label: "ok", html: (t) => (t.is_error ? `<span class="bad">error</span>` : `<span class="ok">ok</span>`) },
    { label: "time", get: (t) => ms(t.duration_ms), num: 1 },
    { label: "input", get: (t) => (t.input ?? "").slice(0, 80) },
  ], d.tools));
  mount("#run-detail", el);
}

// ---------- bench ----------
loaders.bench = async () => {
  const runs = await api("/api/bench");
  mount("#bench-list", table([
    { label: "started", get: (r) => new Date(r.started_at).toLocaleString() },
    { label: "model", get: (r) => r.model, clip: 1 },
    { label: "trials", get: (r) => r.trials, num: 1 },
  ], runs, showBench));
};
async function showBench(r) {
  const { summary } = await api(`/api/bench/${encodeURIComponent(r.id)}`);
  if (!summary) return mount("#bench-detail", Object.assign(document.createElement("p"), { textContent: "No summary yet (run in progress?)" }));
  const o = summary.overall;
  const el = document.createElement("div");
  el.innerHTML = `<div class="kpis" style="grid-template-columns:repeat(3,1fr)">${[
    [`${o.passes}/${o.trials}`, `trials passed (95% CI ${pct(o.wilson.low)}–${pct(o.wilson.high)})`],
    [pct(o.meanPassAt1), "mean pass@1"],
    [pct(o.meanPassHatK), `mean pass^${summary.k}`],
    [`${o.solvedAny}/${summary.tasks.length}`, "tasks solved ≥1×"],
    [num(o.meanDecodeTps, 1), "decode tok/s"],
    [ms(o.p50WallMs), "wall p50 / trial"],
  ].map(([v, l]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("")}</div>`;
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
}

// ---------- models ----------
let mTimer;
loaders.models = async () => {
  const q = new URLSearchParams({ q: $("#m-q").value, kind: $("#m-kind").value, limit: "300", ...($("#m-local").checked ? { local: "1" } : {}), ...($("#m-tools").checked ? { tools: "1" } : {}) });
  const ms_ = await api(`/api/models?${q}`);
  mount("#models", table([
    { label: "model", get: (m) => `${m.provider}/${m.id}`, html: (m) => `${m.local ? '<span class="tag">local</span> ' : ""}${esc(m.provider)}/${esc(m.id)}`, clip: 1 },
    { label: "kinds", get: (m) => m.kinds.join(", ") },
    { label: "context", get: (m) => num(m.contextWindow), num: 1 },
    { label: "tools", html: (m) => (m.toolCall ? '<span class="ok">yes</span>' : '<span class="muted">no</span>') },
    { label: "in → out", get: (m) => `${m.inputModalities.join("+")} → ${m.outputModalities.join("+")}` },
    { label: "quant", get: (m) => m.local?.quantization ?? "" },
    { label: "size", get: (m) => gb(m.local?.sizeBytes), num: 1 },
    { label: "$ in/out per M", get: (m) => (m.cost?.input !== undefined ? `${m.cost.input} / ${m.cost.output ?? "?"}` : ""), num: 1 },
  ], ms_));
};
["#m-q", "#m-kind", "#m-local", "#m-tools"].forEach((s) => $(s).addEventListener("input", () => (clearTimeout(mTimer), (mTimer = setTimeout(loaders.models, 250)))));

// ---------- chat ----------
let sessionId = null;
async function fillModels() {
  const ms_ = await api("/api/models?local=1&kind=chat&limit=100");
  const doc = await api("/api/doctor");
  $("#chat-model").innerHTML = ms_.map((m) => `<option ${`${m.provider}/${m.id}` === doc.defaultModel ? "selected" : ""}>${esc(m.provider)}/${esc(m.id)}</option>`).join("");
}
loaders.chat = () => fillModels();
$("#chat-new").addEventListener("click", () => {
  sessionId = null;
  $("#chat-log").replaceChildren();
  $("#chat-meta").textContent = "";
});
$("#chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = $("#chat-input").value.trim();
  if (!prompt) return;
  const log = $("#chat-log");
  const btn = e.submitter;
  btn.disabled = true;
  $("#chat-input").value = "";
  log.insertAdjacentHTML("beforeend", `<div class="msg user"><div class="text">${esc(prompt)}</div></div>`);
  const msg = document.createElement("div");
  msg.className = "msg";
  log.append(msg);
  let textEl = null;
  const tools = new Map();
  try {
    const res = await fetch("/api/chat", { method: "POST", headers: { "x-ah-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify({ prompt, model: $("#chat-model").value, sessionId }) });
    if (!res.ok) throw new Error((await res.json()).error);
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
        if (ev.type === "session") {
          sessionId = ev.sessionId;
          $("#chat-meta").textContent = `${ev.model} · context ${num(ev.contextWindow)}`;
        } else if (ev.type === "text_delta") {
          if (!textEl) msg.append((textEl = Object.assign(document.createElement("div"), { className: "text" })));
          textEl.textContent += ev.text;
        } else if (ev.type === "tool_start") {
          textEl = null;
          const t = Object.assign(document.createElement("div"), { className: "tool", textContent: `⏵ ${ev.summary}` });
          tools.set(ev.id, t);
          msg.append(t);
        } else if (ev.type === "tool_end") {
          const t = tools.get(ev.id);
          if (t) {
            t.classList.add(ev.isError ? "err" : "done");
            t.textContent += `  ${ev.isError ? "✗" : "✓"} ${ms(ev.durationMs)}${ev.isError ? ` — ${ev.preview.split("\n")[0].slice(0, 160)}` : ""}`;
          }
        } else if (ev.type === "run_end") {
          const r = ev.result;
          msg.insertAdjacentHTML("beforeend", `<div class="stats">${esc(r.outcome)} · ${r.turns} turns · ${r.toolCalls} tools · ${ms(r.wallMs)} · ${num(r.usage.inputTokens)} in / ${num(r.usage.outputTokens)} out${r.changedFiles.length ? ` · changed ${esc(r.changedFiles.join(", "))}` : ""}</div>`);
        } else if (ev.type === "error") msg.insertAdjacentHTML("beforeend", `<div class="tool err">${esc(ev.message)}</div>`);
        log.scrollTop = log.scrollHeight;
      }
    }
  } catch (err) {
    msg.insertAdjacentHTML("beforeend", `<div class="tool err">${esc(err.message)}</div>`);
  } finally {
    btn.disabled = false;
  }
});

// ---------- media ----------
$("#img-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = $("#img-out");
  out.innerHTML = `<div class="skeleton"></div>`;
  e.submitter.disabled = true;
  try {
    const r = await api("/api/image", { prompt: $("#img-prompt").value });
    out.innerHTML = r.images.map((im) => `<img alt="generated image" src="data:${esc(im.mediaType)};base64,${esc(im.data)}">`).join("") + `<p class="muted">${esc(r.backend)} · ${ms(r.ms)}</p>`;
  } catch (err) {
    out.innerHTML = `<p class="bad">${esc(err.message)}</p>`;
  } finally {
    e.submitter.disabled = false;
  }
});
$("#m3d-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = $("#m3d-out");
  out.innerHTML = `<div class="skeleton"></div>`;
  e.submitter.disabled = true;
  try {
    const r = await api("/api/3d", { prompt: $("#m3d-prompt").value });
    const blob = new Blob([Uint8Array.from(atob(r.glb), (c) => c.charCodeAt(0))], { type: "model/gltf-binary" });
    out.innerHTML = `<img alt="3D preview" src="data:image/png;base64,${esc(r.preview)}"><p class="muted">${esc(r.model)} · ${r.scene.objects.length} parts · ${num(r.triangles)} triangles · ${ms(r.ms)} · <a download="model.glb" href="${URL.createObjectURL(blob)}">download .glb</a></p>`;
  } catch (err) {
    out.innerHTML = `<p class="bad">${esc(err.message)}</p>`;
  } finally {
    e.submitter.disabled = false;
  }
});

// ---------- system ----------
loaders.system = async () => {
  const d = await api("/api/doctor");
  $("#runtimes").innerHTML = d.runtimes.length
    ? d.runtimes.map((r) => `<div style="margin-bottom:12px"><strong>${esc(r.key)}</strong> <span class="tag">${esc(r.kind)} ${esc(r.version ?? "")}</span> <span class="muted">${esc(r.baseURL)}</span><div class="muted" style="font-size:12px">${r.models.map(esc).join("<br>") || "no models"}</div></div>`).join("")
    : `<p class="muted">No local runtimes discovered.</p>`;
  const h = d.hardware;
  $("#hardware").innerHTML = `<dl class="kv"><dt>GPU</dt><dd>${esc(h.gpuName ?? "–")}</dd><dt>GPU utilisation</dt><dd>${h.gpuUtilPct ?? "–"}%</dd><dt>GPU allocated</dt><dd>${gb(h.gpuAllocBytes)}</dd><dt>memory</dt><dd>${gb(h.memTotalBytes)} (free ${gb(h.memFreeBytes)})</dd><dt>CPU threads</dt><dd>${h.cpuCount}</dd><dt>load (1m)</dt><dd>${num(h.load1, 2)}</dd><dt>workspace</dt><dd>${esc(d.root)}</dd><dt>catalog</dt><dd>${num(d.catalogSize)} models</dd></dl>`;
};
async function pollHw() {
  try {
    const h = await api("/api/hardware");
    $("#hw-pill").textContent = `GPU ${h.gpuUtilPct ?? "–"}% · ${gb(h.gpuAllocBytes)} · load ${num(h.load1, 1)}`;
  } catch {
    $("#hw-pill").textContent = "offline";
  }
}
pollHw();
setInterval(pollHw, 3000);
loaders.overview();
