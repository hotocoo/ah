// Procedural mesh construction and 3D file export (GLB, glTF, OBJ, STL).

export type Vec3 = [number, number, number];

export interface Mesh {
  name: string;
  positions: number[]; // xyz per vertex
  normals: number[];
  indices: number[]; // triangles
  color: [number, number, number, number]; // linear RGBA 0..1
}

export type ShapeKind = "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane" | "capsule";

export interface SceneObject {
  name?: string;
  shape: ShapeKind;
  size?: Vec3; // box / plane extents
  radius?: number;
  height?: number;
  tube?: number; // torus minor radius
  segments?: number;
  position?: Vec3;
  rotation?: Vec3; // degrees, XYZ order
  scale?: Vec3;
  color?: string; // #rrggbb
}

export interface Scene {
  name?: string;
  objects: SceneObject[];
}

export const SHAPES: ShapeKind[] = ["box", "sphere", "cylinder", "cone", "torus", "plane", "capsule"];

function hexColor(c?: string): [number, number, number, number] {
  const m = c?.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return [0.8, 0.8, 0.8, 1];
  const n = Number.parseInt(m[1]!, 16);
  // sRGB -> linear for glTF baseColorFactor
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255), 1];
}

function builder() {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  return {
    positions,
    normals,
    indices,
    vert(p: Vec3, n: Vec3) {
      positions.push(...p);
      normals.push(...n);
      return positions.length / 3 - 1;
    },
    tri(a: number, b: number, c: number) {
      indices.push(a, b, c);
    },
  };
}

function box([sx, sy, sz]: Vec3) {
  const b = builder();
  const [x, y, z] = [sx / 2, sy / 2, sz / 2];
  const faces: [Vec3, Vec3[]][] = [
    [[1, 0, 0], [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]]],
    [[-1, 0, 0], [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]]],
    [[0, 1, 0], [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]]],
    [[0, -1, 0], [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]]],
    [[0, 0, 1], [[x, -y, z], [x, y, z], [-x, y, z], [-x, -y, z]]],
    [[0, 0, -1], [[-x, -y, -z], [-x, y, -z], [x, y, -z], [x, -y, -z]]],
  ];
  for (const [n, q] of faces) {
    const i = q.map((p) => b.vert(p, n));
    b.tri(i[0]!, i[1]!, i[2]!);
    b.tri(i[0]!, i[2]!, i[3]!);
  }
  return b;
}

function sphere(r: number, seg: number) {
  const b = builder();
  const rings = Math.max(4, Math.floor(seg / 2));
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * Math.PI;
    for (let j = 0; j <= seg; j++) {
      const ph = (j / seg) * Math.PI * 2;
      const n: Vec3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      b.vert([n[0] * r, n[1] * r, n[2] * r], n);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const c = a + seg + 1;
      b.tri(a, a + 1, c);
      b.tri(a + 1, c + 1, c);
    }
  return b;
}

// Cylinder (r1 == r2) or cone (r2 == 0), centred on the origin along +Y.
function frustum(r1: number, r2: number, h: number, seg: number) {
  const b = builder();
  const y0 = -h / 2;
  const y1 = h / 2;
  const slope = (r1 - r2) / h;
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * Math.PI * 2;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const len = Math.hypot(1, slope);
    const n: Vec3 = [c / len, slope / len, s / len];
    b.vert([c * r1, y0, s * r1], n);
    b.vert([c * r2, y1, s * r2], n);
  }
  for (let j = 0; j < seg; j++) {
    const i = j * 2;
    b.tri(i, i + 1, i + 2);
    b.tri(i + 1, i + 3, i + 2);
  }
  const cap = (y: number, r: number, up: boolean) => {
    if (r <= 0) return;
    const n: Vec3 = [0, up ? 1 : -1, 0];
    const center = b.vert([0, y, 0], n);
    const ring: number[] = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push(b.vert([Math.cos(a) * r, y, Math.sin(a) * r], n));
    }
    for (let j = 0; j < seg; j++) up ? b.tri(center, ring[j + 1]!, ring[j]!) : b.tri(center, ring[j]!, ring[j + 1]!);
  };
  cap(y0, r1, false);
  cap(y1, r2, true);
  return b;
}

function torus(R: number, r: number, seg: number) {
  const b = builder();
  const tubeSeg = Math.max(6, Math.floor(seg / 2));
  for (let i = 0; i <= seg; i++) {
    const u = (i / seg) * Math.PI * 2;
    for (let j = 0; j <= tubeSeg; j++) {
      const v = (j / tubeSeg) * Math.PI * 2;
      const n: Vec3 = [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)];
      b.vert([(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)], n);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < tubeSeg; j++) {
      const a = i * (tubeSeg + 1) + j;
      const c = a + tubeSeg + 1;
      b.tri(a, c, a + 1);
      b.tri(a + 1, c, c + 1);
    }
  return b;
}

function plane([sx, , sz]: Vec3) {
  const b = builder();
  const n: Vec3 = [0, 1, 0];
  const i = [b.vert([-sx / 2, 0, -sz / 2], n), b.vert([-sx / 2, 0, sz / 2], n), b.vert([sx / 2, 0, sz / 2], n), b.vert([sx / 2, 0, -sz / 2], n)];
  b.tri(i[0]!, i[1]!, i[2]!);
  b.tri(i[0]!, i[2]!, i[3]!);
  return b;
}

function capsule(r: number, h: number, seg: number) {
  const body = frustum(r, r, h, seg);
  const top = sphere(r, seg);
  const bottom = sphere(r, seg);
  const merge = (dst: ReturnType<typeof builder>, src: ReturnType<typeof builder>, dy: number) => {
    const off = dst.positions.length / 3;
    for (let i = 0; i < src.positions.length; i += 3) dst.vert([src.positions[i]!, src.positions[i + 1]! + dy, src.positions[i + 2]!], [src.normals[i]!, src.normals[i + 1]!, src.normals[i + 2]!]);
    for (let i = 0; i < src.indices.length; i += 3) dst.tri(src.indices[i]! + off, src.indices[i + 1]! + off, src.indices[i + 2]! + off);
  };
  merge(body, top, h / 2);
  merge(body, bottom, -h / 2);
  return body;
}

// 3x3 rotation from XYZ Euler degrees.
function rotation([rx, ry, rz]: Vec3): number[] {
  const [a, b, c] = [rx, ry, rz].map((d) => (d * Math.PI) / 180) as Vec3;
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  // R = Rz * Ry * Rx
  return [cb * cc, sa * sb * cc - ca * sc, ca * sb * cc + sa * sc, cb * sc, sa * sb * sc + ca * cc, ca * sb * sc - sa * cc, -sb, sa * cb, ca * cb];
}

export function buildMesh(o: SceneObject, index = 0): Mesh {
  const seg = Math.min(128, Math.max(8, o.segments ?? 32));
  const r = o.radius ?? 0.5;
  const h = o.height ?? 1;
  const b =
    o.shape === "box"
      ? box(o.size ?? [1, 1, 1])
      : o.shape === "sphere"
        ? sphere(r, seg)
        : o.shape === "cylinder"
          ? frustum(r, r, h, seg)
          : o.shape === "cone"
            ? frustum(r, 0, h, seg)
            : o.shape === "torus"
              ? torus(r, o.tube ?? r * 0.3, seg)
              : o.shape === "plane"
                ? plane(o.size ?? [1, 0, 1])
                : capsule(r, h, seg);
  const R = rotation(o.rotation ?? [0, 0, 0]);
  const [sx, sy, sz] = o.scale ?? [1, 1, 1];
  const [px, py, pz] = o.position ?? [0, 0, 0];
  const pos: number[] = [];
  const nor: number[] = [];
  for (let i = 0; i < b.positions.length; i += 3) {
    const [x, y, z] = [b.positions[i]! * sx, b.positions[i + 1]! * sy, b.positions[i + 2]! * sz];
    pos.push(R[0]! * x + R[1]! * y + R[2]! * z + px, R[3]! * x + R[4]! * y + R[5]! * z + py, R[6]! * x + R[7]! * y + R[8]! * z + pz);
    // Normals: inverse-transpose of scale, then rotate, then renormalise.
    const [nx, ny, nz] = [b.normals[i]! / sx, b.normals[i + 1]! / sy, b.normals[i + 2]! / sz];
    const rn: Vec3 = [R[0]! * nx + R[1]! * ny + R[2]! * nz, R[3]! * nx + R[4]! * ny + R[5]! * nz, R[6]! * nx + R[7]! * ny + R[8]! * nz];
    const l = Math.hypot(...rn) || 1;
    nor.push(rn[0] / l, rn[1] / l, rn[2] / l);
  }
  return { name: o.name ?? `${o.shape}_${index}`, positions: pos, normals: nor, indices: b.indices, color: hexColor(o.color) };
}

export const buildScene = (s: Scene): Mesh[] => s.objects.map((o, i) => buildMesh(o, i));

export function bounds(meshes: Mesh[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, m.positions[i + k]!);
        max[k] = Math.max(max[k]!, m.positions[i + k]!);
      }
  return { min, max };
}

// ---- exporters ----

export function toObj(meshes: Mesh[]): string {
  const out: string[] = ["# generated by ah (Aletheia Harness)"];
  let base = 1;
  for (const m of meshes) {
    out.push(`o ${m.name}`);
    const [r, g, b] = m.color;
    for (let i = 0; i < m.positions.length; i += 3) out.push(`v ${m.positions[i]!.toFixed(5)} ${m.positions[i + 1]!.toFixed(5)} ${m.positions[i + 2]!.toFixed(5)} ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`);
    for (let i = 0; i < m.normals.length; i += 3) out.push(`vn ${m.normals[i]!.toFixed(4)} ${m.normals[i + 1]!.toFixed(4)} ${m.normals[i + 2]!.toFixed(4)}`);
    for (let i = 0; i < m.indices.length; i += 3) {
      const [a, b2, c] = [m.indices[i]! + base, m.indices[i + 1]! + base, m.indices[i + 2]! + base];
      out.push(`f ${a}//${a} ${b2}//${b2} ${c}//${c}`);
    }
    base += m.positions.length / 3;
  }
  return `${out.join("\n")}\n`;
}

export function toStl(meshes: Mesh[]): Buffer {
  const tris = meshes.reduce((a, m) => a + m.indices.length / 3, 0);
  const buf = Buffer.alloc(84 + tris * 50);
  buf.write("ah binary STL", 0, "ascii");
  buf.writeUInt32LE(tris, 80);
  let o = 84;
  for (const m of meshes)
    for (let i = 0; i < m.indices.length; i += 3) {
      const v = [m.indices[i]!, m.indices[i + 1]!, m.indices[i + 2]!].map((k) => [m.positions[k * 3]!, m.positions[k * 3 + 1]!, m.positions[k * 3 + 2]!] as Vec3);
      const e1 = [v[1]![0] - v[0]![0], v[1]![1] - v[0]![1], v[1]![2] - v[0]![2]];
      const e2 = [v[2]![0] - v[0]![0], v[2]![1] - v[0]![1], v[2]![2] - v[0]![2]];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      for (const x of n) (buf.writeFloatLE(x / l, o), (o += 4));
      for (const p of v) for (const x of p) (buf.writeFloatLE(x, o), (o += 4));
      o += 2; // attribute byte count
    }
  return buf;
}

// glTF 2.0 document + binary buffer (one mesh/node/material per object).
function gltfParts(meshes: Mesh[], sceneName: string) {
  const chunks: Buffer[] = [];
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const push = (data: Buffer, target: number) => {
    const pad = (4 - (data.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target });
    chunks.push(data, Buffer.alloc(pad));
    offset += data.length + pad;
    return bufferViews.length - 1;
  };
  const gMeshes: object[] = [];
  const materials: object[] = [];
  meshes.forEach((m, i) => {
    const pos = Buffer.from(new Float32Array(m.positions).buffer);
    const nor = Buffer.from(new Float32Array(m.normals).buffer);
    const idx = Buffer.from(new Uint32Array(m.indices).buffer);
    const { min, max } = bounds([m]);
    accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: m.positions.length / 3, type: "VEC3", min, max });
    accessors.push({ bufferView: push(nor, 34962), componentType: 5126, count: m.normals.length / 3, type: "VEC3" });
    accessors.push({ bufferView: push(idx, 34963), componentType: 5125, count: m.indices.length, type: "SCALAR" });
    materials.push({ name: `${m.name}_mat`, pbrMetallicRoughness: { baseColorFactor: m.color, metallicFactor: 0, roughnessFactor: 0.8 } });
    gMeshes.push({ name: m.name, primitives: [{ attributes: { POSITION: i * 3, NORMAL: i * 3 + 1 }, indices: i * 3 + 2, material: i }] });
  });
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: "2.0", generator: "ah (Aletheia Harness)" },
    scene: 0,
    scenes: [{ name: sceneName, nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((m, i) => ({ name: m.name, mesh: i })),
    meshes: gMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  return { json, bin };
}

export function toGltf(meshes: Mesh[], name = "scene"): string {
  const { json, bin } = gltfParts(meshes, name);
  json.buffers = [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString("base64")}` } as { byteLength: number }];
  return JSON.stringify(json);
}

export function toGlb(meshes: Mesh[], name = "scene"): Buffer {
  const { json, bin } = gltfParts(meshes, name);
  let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4); // "JSON"
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4); // "BIN\0"
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}

export function exportScene(meshes: Mesh[], format: string, name?: string): Buffer {
  switch (format) {
    case "glb":
      return toGlb(meshes, name);
    case "gltf":
      return Buffer.from(toGltf(meshes, name));
    case "obj":
      return Buffer.from(toObj(meshes));
    case "stl":
      return toStl(meshes);
    default:
      throw new Error(`unsupported 3D format: ${format} (glb, gltf, obj, stl)`);
  }
}
