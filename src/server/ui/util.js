// Shared helpers for the web app modules. All dynamic text goes through esc (model output is untrusted).
export const TOKEN = document.querySelector('meta[name="ah-token"]').content;
export const $ = (s) => document.querySelector(s);
export const $$ = (s) => [...document.querySelectorAll(s)];
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let inflight = 0;
export const busy = (d) => document.body.classList.toggle("busy", (inflight = Math.max(0, inflight + d)) > 0);
export const api = async (path, body, quiet = false) => {
  if (!quiet) busy(1);
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-ah-token": TOKEN, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).finally(() => quiet || busy(-1));
  const j = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
  if (!res.ok) throw new Error(j.error ?? res.statusText);
  return j;
};
export const num = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? "-" : Number(x).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
export const ms = (x) => (x === null || x === undefined ? "-" : x < 1000 ? `${num(x)} ms` : `${num(x / 1000, 1)} s`);
export const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? "-" : `${num(x * 100)}%`);
export const gb = (b) => (b ? `${num(b / 1024 ** 3, 1)} GB` : "-");
export const compact = (x) => (x === null || x === undefined ? "-" : Number(x).toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 }));
export const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? `${num(s)}s ago` : s < 3600 ? `${num(s / 60)}m ago` : s < 86400 ? `${num(s / 3600)}h ago` : new Date(t).toLocaleDateString();
};
export const plural = (n, w) => `${num(n)} ${w}${n === 1 ? "" : "s"}`;
export const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const html = (s) => {
  const t = document.createElement("template");
  t.innerHTML = s;
  return t.content;
};

export const alertBox = (title, message, retry) => {
  const el = html(`<div class="alert" role="alert"><span class="glyph" aria-hidden="true">!</span><div><strong>${esc(title)}</strong><p>${esc(message)}</p></div>${retry ? '<button type="button" class="ghost">Retry</button>' : ""}</div>`).firstElementChild;
  if (retry) el.querySelector("button").addEventListener("click", retry);
  return el;
};
