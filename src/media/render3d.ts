import { bounds, type Mesh, type Vec3 } from "./mesh.ts";
import { encodePng } from "./png.ts";

// Software rasteriser for 3D previews: perspective 3/4 view, z-buffer, Lambert shading.
export function renderPreview(meshes: Mesh[], width = 512, height = 512): Buffer {
  const { min, max } = bounds(meshes);
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(1e-6, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  // Camera on a 3/4 elevated view looking at the centre.
  const dir: Vec3 = [0.6, 0.45, 0.66];
  const dl = Math.hypot(...dir);
  const eye: Vec3 = [center[0] + (dir[0] / dl) * radius * 3, center[1] + (dir[1] / dl) * radius * 3, center[2] + (dir[2] / dl) * radius * 3];
  const f = norm(sub(center, eye));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const focal = (Math.min(width, height) / 2) / Math.tan((25 * Math.PI) / 180);
  const light = norm([0.4, 0.8, 0.5]);

  const color = new Float32Array(width * height * 3);
  const depth = new Float32Array(width * height).fill(Infinity);
  // Background gradient.
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const t = y / height;
      const i = (y * width + x) * 3;
      color[i] = 0.93 - t * 0.12;
      color[i + 1] = 0.94 - t * 0.12;
      color[i + 2] = 0.96 - t * 0.1;
    }

  const project = (p: Vec3): [number, number, number] => {
    const d = sub(p, eye);
    const z = dot(d, f);
    return [width / 2 + (dot(d, r) * focal) / z, height / 2 - (dot(d, u) * focal) / z, z];
  };

  for (const m of meshes) {
    const proj: [number, number, number][] = [];
    for (let i = 0; i < m.positions.length; i += 3) proj.push(project([m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!]));
    for (let t = 0; t < m.indices.length; t += 3) {
      const [ia, ib, ic] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
      const [a, b, c] = [proj[ia]!, proj[ib]!, proj[ic]!];
      if (a[2] <= 0 || b[2] <= 0 || c[2] <= 0) continue;
      // Face normal from geometry (world space) for shading; two-sided.
      const pa: Vec3 = [m.positions[ia * 3]!, m.positions[ia * 3 + 1]!, m.positions[ia * 3 + 2]!];
      const pb: Vec3 = [m.positions[ib * 3]!, m.positions[ib * 3 + 1]!, m.positions[ib * 3 + 2]!];
      const pc: Vec3 = [m.positions[ic * 3]!, m.positions[ic * 3 + 1]!, m.positions[ic * 3 + 2]!];
      let n = norm(cross(sub(pb, pa), sub(pc, pa)));
      if (dot(n, sub(eye, pa)) < 0) n = [-n[0], -n[1], -n[2]];
      const shade = 0.25 + 0.75 * Math.max(0, dot(n, light));
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const area = edge(a, b, c[0], c[1]);
      if (Math.abs(area) < 1e-9) continue;
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const w0 = edge(b, c, x + 0.5, y + 0.5) / area;
          const w1 = edge(c, a, x + 0.5, y + 0.5) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
          const k = y * width + x;
          if (z >= depth[k]!) continue;
          depth[k] = z;
          color[k * 3] = m.color[0] * shade;
          color[k * 3 + 1] = m.color[1] * shade;
          color[k * 3 + 2] = m.color[2] * shade;
        }
    }
  }
  // Linear -> sRGB.
  const srgb = (v: number) => Math.round(255 * Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
  return encodePng(width, height, (x, y) => {
    const i = (y * width + x) * 3;
    return [srgb(color[i]!), srgb(color[i + 1]!), srgb(color[i + 2]!), 255];
  });
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const edge = (a: [number, number, number], b: [number, number, number], x: number, y: number) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
