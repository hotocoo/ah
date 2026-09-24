// Run-state signal and accent colours for canvas drawing. No ambient animation: motion in the
// UI is reserved for state changes (run progress, loading, focus), not decoration.

// Canvas cannot parse CSS custom properties or oklch(from ...) expressions, so each colour is
// resolved through a probe element and painted into a 1x1 canvas to read back plain RGB.
const GOLD = [200, 140, 60];
const GOLD_HI = [230, 180, 100];
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
  GOLD.splice(0, 3, ...cssRgb("--accent"));
  GOLD_HI.splice(0, 3, ...cssRgb("--accent-strong"));
}

export const fx = {
  init() {},
  // state: idle | thinking | tool | done | error
  energy(state) {
    document.body.dataset.run = state === "thinking" || state === "tool" ? "active" : state;
  },
  syncCores() {},
};
