import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Web UI appearance: a skin (surface preset), an accent colour, and an optional uploaded
// wallpaper with opacity / blur / dim. Stored in the data dir; the wallpaper is one fixed file,
// so an upload can never choose a path.

export const SKINS = ["obsidian", "graphite", "forest", "ember"] as const;
export interface Appearance {
  skin: (typeof SKINS)[number];
  accent: string | null; // #rrggbb; null = the skin's own accent
  wallpaper: { enabled: boolean; opacity: number; blur: number; dim: number };
}

export const DEFAULT_APPEARANCE: Appearance = { skin: "obsidian", accent: null, wallpaper: { enabled: false, opacity: 0.6, blur: 8, dim: 0.35 } };
export const MAX_WALLPAPER_BYTES = 12 * 1024 * 1024;

const clampNum = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

// Unknown or malformed fields fall back to defaults; nothing from the client is stored verbatim.
export function sanitizeAppearance(raw: unknown, base: Appearance = DEFAULT_APPEARANCE): Appearance {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const w = (r.wallpaper && typeof r.wallpaper === "object" ? r.wallpaper : {}) as Record<string, unknown>;
  const skin = SKINS.includes(r.skin as Appearance["skin"]) ? (r.skin as Appearance["skin"]) : base.skin;
  const accent = r.accent === null ? null : typeof r.accent === "string" && /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent.toLowerCase() : base.accent;
  return {
    skin,
    accent,
    wallpaper: {
      enabled: typeof w.enabled === "boolean" ? w.enabled : base.wallpaper.enabled,
      opacity: clampNum(w.opacity, 0, 1, base.wallpaper.opacity),
      blur: clampNum(w.blur, 0, 40, base.wallpaper.blur),
      dim: clampNum(w.dim, 0, 0.9, base.wallpaper.dim),
    },
  };
}

// Image type from magic bytes; the file name and client content-type are ignored.
export function sniffImage(b: Uint8Array): string | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, j) => b[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) return "image/avif";
  return null;
}

export class AppearanceStore {
  constructor(private dir: string) {}
  private get file() {
    return join(this.dir, "appearance.json");
  }
  private get image() {
    return join(this.dir, "wallpaper.img");
  }

  get(): Appearance & { hasWallpaper: boolean } {
    let saved: unknown = {};
    try {
      if (existsSync(this.file)) saved = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      // A corrupt file falls back to defaults; the next save rewrites it.
    }
    return { ...sanitizeAppearance(saved), hasWallpaper: existsSync(this.image) };
  }

  set(patch: unknown): Appearance & { hasWallpaper: boolean } {
    const { hasWallpaper: _h, ...cur } = this.get();
    writeFileSync(this.file, JSON.stringify(sanitizeAppearance(patch, cur), null, 2));
    return this.get();
  }

  wallpaper(): { body: Uint8Array; type: string } | null {
    if (!existsSync(this.image)) return null;
    const body = new Uint8Array(readFileSync(this.image));
    const type = sniffImage(body);
    return type ? { body, type } : null;
  }

  // Throws with a user-facing message; the caller maps it to 400/413.
  saveWallpaper(body: Uint8Array): void {
    if (body.length === 0) throw new Error("empty upload");
    if (body.length > MAX_WALLPAPER_BYTES) throw new Error(`wallpaper larger than ${MAX_WALLPAPER_BYTES / 1024 / 1024} MB`);
    if (!sniffImage(body)) throw new Error("not a PNG, JPEG, WebP, GIF or AVIF image");
    writeFileSync(this.image, body);
    this.set({ wallpaper: { enabled: true } });
  }

  removeWallpaper(): void {
    rmSync(this.image, { force: true });
    this.set({ wallpaper: { enabled: false } });
  }
}
