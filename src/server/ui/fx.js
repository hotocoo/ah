// Ambient motion layer: gold light field + dust on a canvas, the harness core's ring speed,
// magnetic buttons. Everything reacts to one "energy" level driven by the agent's run state.
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
let energy = 0;
let target = 0;

// Canvas colours follow the CSS accent (skins, user accent). CSS custom properties can hold
// oklch(from var(...)) expressions a canvas cannot parse, so each is resolved through a probe
// element and painted into a 1x1 canvas to read back plain RGB.
const GOLD = [212, 173, 90];
const GOLD_HI = [243, 223, 166];
export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function cssRgb(prop) {
  const probe = document.createElement("i");
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${prop})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  c.fillStyle = color;
  c.fillRect(0, 0, 1, 1);
  return [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)];
}
export const accent = { gold: GOLD, hi: GOLD_HI };
export function readAccent() {
  GOLD.splice(0, 3, ...cssRgb("--gold"));
  GOLD_HI.splice(0, 3, ...cssRgb("--gold-hi"));
}

// Slow Lissajous paths for the light fields; depth scales pointer parallax.
const BLOBS = [
  { cx: 0.78, cy: 0.12, ax: 0.1, ay: 0.08, f: 0.00011, p: 0, r: 0.6, a: 0.24, depth: 1, c: GOLD },
  { cx: 0.15, cy: 0.9, ax: 0.12, ay: 0.06, f: 0.00008, p: 2.1, r: 0.55, a: 0.17, depth: 0.6, c: GOLD },
  { cx: 0.5, cy: 0.55, ax: 0.22, ay: 0.14, f: 0.00006, p: 4.2, r: 0.4, a: 0.08, depth: 1.4, c: GOLD_HI },
  { cx: 0.95, cy: 0.75, ax: 0.06, ay: 0.12, f: 0.00013, p: 1.3, r: 0.32, a: 0.11, depth: 0.8, c: GOLD },
];

function field(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  // Glow fields are soft, so they render at 1/6 scale and upscale for free.
  const glow = document.createElement("canvas");
  const gctx = glow.getContext("2d");
  const G = 6;
  const dust = [];
  let w = 0, h = 0;
  let mx = 0.5, my = 0.35, sx = 0.5, sy = 0.35;
  let raf = 0;

  const seed = () => {
    const n = Math.round(Math.min(280, (w * h) / 5000));
    dust.length = 0;
    for (let i = 0; i < n; i++) {
      const z = Math.random() * 0.8 + 0.2;
      dust.push({ x: Math.random() * w, y: Math.random() * h, z, r: 0.5 + z * 1.7, tw: Math.random() * Math.PI * 2, vx: (Math.random() - 0.5) * 0.06 });
    }
  };
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    w = innerWidth;
    h = innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    glow.width = Math.ceil(w / G);
    glow.height = Math.ceil(h / G);
    seed();
  };

  const draw = (t) => {
    energy += (target - energy) * 0.025;
    sx += (mx - sx) * 0.04;
    sy += (my - sy) * 0.04;
    const e = energy;
    const gw = glow.width, gh = glow.height, span = Math.max(gw, gh);
    gctx.globalCompositeOperation = "source-over";
    gctx.clearRect(0, 0, gw, gh);
    gctx.globalCompositeOperation = "lighter";
    for (const b of BLOBS) {
      const x = gw * (b.cx + b.ax * Math.sin(t * b.f * (1 + e) + b.p)) + ((sx - 0.5) * 60 * b.depth) / G;
      const y = gh * (b.cy + b.ay * Math.cos(t * b.f * 1.3 * (1 + e) + b.p)) + ((sy - 0.5) * 40 * b.depth) / G;
      const r = span * b.r * (1 + e * 0.15);
      const g = gctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(b.c, b.a * (1 + e * 0.9)));
      g.addColorStop(0.45, rgba(b.c, b.a * 0.35 * (1 + e)));
      g.addColorStop(1, rgba(b.c, 0));
      gctx.fillStyle = g;
      gctx.fillRect(0, 0, gw, gh);
    }
    // slow light beams falling from the top right
    for (let i = 0; i < 3; i++) {
      const ang = -0.62 + i * 0.16 + Math.sin(t * 0.00007 * (i + 1) + i) * 0.05;
      const bw = gw * (0.1 + i * 0.05);
      gctx.save();
      gctx.translate(gw * (0.92 - i * 0.12), -gh * 0.1);
      gctx.rotate(ang);
      const lg = gctx.createLinearGradient(-bw, 0, bw, 0);
      const k = (0.05 + 0.03 * Math.sin(t * 0.0003 + i * 2)) * (1 + e);
      lg.addColorStop(0, rgba(GOLD, 0));
      lg.addColorStop(0.5, rgba(GOLD_HI, k));
      lg.addColorStop(1, rgba(GOLD, 0));
      gctx.fillStyle = lg;
      gctx.fillRect(-bw, 0, bw * 2, span * 2);
      gctx.restore();
    }
    // soft spotlight trailing the pointer
    const px = sx * gw, py = sy * gh, sr = 320 / G;
    const s = gctx.createRadialGradient(px, py, 0, px, py, sr);
    s.addColorStop(0, rgba(GOLD_HI, 0.05 + e * 0.04));
    s.addColorStop(1, rgba(GOLD_HI, 0));
    gctx.fillStyle = s;
    gctx.fillRect(px - sr, py - sr, sr * 2, sr * 2);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(glow, 0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";

    const lift = 0.1 + e * 0.9;
    for (const d of dust) {
      d.y -= lift * d.z;
      d.x += d.vx + Math.sin(t * 0.0005 + d.tw) * 0.12 * d.z;
      if (d.y < -4) (d.y = h + 4), (d.x = Math.random() * w);
      if (d.x < -4) d.x = w + 4;
      else if (d.x > w + 4) d.x = -4;
      const a = (0.25 + 0.7 * Math.abs(Math.sin(t * 0.0011 + d.tw))) * d.z * (0.7 + e * 0.5);
      const x = d.x + (sx - 0.5) * 36 * d.z, y = d.y + (sy - 0.5) * 24 * d.z;
      ctx.fillStyle = rgba(d.z > 0.75 ? GOLD_HI : GOLD, a.toFixed(3));
      if (d.r < 1) ctx.fillRect(x, y, d.r * 1.6, d.r * 1.6);
      else {
        ctx.beginPath();
        ctx.arc(x, y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  };

  const loop = (t) => {
    draw(t);
    raf = requestAnimationFrame(loop);
  };
  const start = () => {
    cancelAnimationFrame(raf);
    if (reduce.matches) draw(0);
    else raf = requestAnimationFrame(loop);
  };

  resize();
  start();
  addEventListener("resize", () => (resize(), reduce.matches && draw(0)));
  addEventListener("pointermove", (ev) => ((mx = ev.clientX / w), (my = ev.clientY / h)), { passive: true });
  document.addEventListener("visibilitychange", () => (document.hidden ? cancelAnimationFrame(raf) : start()));
  reduce.addEventListener("change", start);
}

// Ring speed follows energy smoothly (playbackRate, so rings never jump).
function syncCores() {
  const rate = target >= 1 ? 3.2 : target > 0 ? 1.6 : 1;
  document.querySelectorAll(".core").forEach((c) => c.getAnimations({ subtree: true }).forEach((a) => a.updatePlaybackRate(rate)));
}

// Buttons lean toward the pointer a few pixels.
function magnetic(sel, pull = 0.18) {
  document.addEventListener("pointermove", (ev) => {
    if (ev.pointerType !== "mouse" || reduce.matches) return;
    const el = ev.target.closest?.(sel);
    document.querySelectorAll(`${sel}.magnet`).forEach((m) => m !== el && (m.classList.remove("magnet"), m.style.removeProperty("--tx"), m.style.removeProperty("--ty")));
    if (!el || el.disabled) return;
    const r = el.getBoundingClientRect();
    el.classList.add("magnet");
    el.style.setProperty("--tx", `${(ev.clientX - r.left - r.width / 2) * pull}px`);
    el.style.setProperty("--ty", `${(ev.clientY - r.top - r.height / 2) * pull}px`);
  }, { passive: true });
}

export const fx = {
  init() {
    const c = document.getElementById("fx-field");
    if (c) field(c);
    magnetic("button.primary");
    magnetic(".chip", 0.08);
  },
  // state: idle | thinking | tool | done | error
  energy(state) {
    target = state === "thinking" || state === "tool" ? 1 : state === "error" ? 0.35 : 0;
    document.body.dataset.run = target >= 1 ? "active" : state;
    syncCores();
  },
  syncCores,
};
