import type { PhotoCredit } from "./appearance.ts";

// A photograph for the photoreal theme, looked up live: Wikimedia Commons' featured picture of
// the day (freely licensed, credited in the UI). Walks back from today to the first landscape
// picture large enough to fill a screen.
const FEED = "https://api.wikimedia.org/feed/v1/wikipedia/en/featured";
const MIN_WIDTH = 1920;
// Commons only renders standard thumbnail widths; 1920 is the largest screen-sized one.
const TARGET_WIDTH = 1920;

interface FeaturedImage {
  title?: string;
  image?: { source: string; width: number; height: number };
  thumbnail?: { source: string };
  artist?: { text?: string };
  license?: { type?: string };
  file_page?: string;
}

export async function fetchDailyPhoto(fetchImpl: typeof fetch = fetch, today = new Date(), days = 14): Promise<{ body: Uint8Array; credit: PhotoCredit }> {
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const path = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
    const res = await fetchImpl(`${FEED}/${path}`, { headers: { "user-agent": "ah (local coding agent harness)" }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!res?.ok) continue;
    const img = ((await res.json()) as { image?: FeaturedImage }).image;
    const full = img?.image;
    if (!img || !full || full.width < MIN_WIDTH || full.width / full.height < 1.3) continue;
    // Commons serves any width from the thumbnail path; take the screen-sized one, not the original.
    const url = img.thumbnail?.source && full.width > TARGET_WIDTH ? img.thumbnail.source.replace(/\/\d+px-/, `/${TARGET_WIDTH}px-`).split("?")[0]! : full.source;
    const pic = await fetchImpl(url, { headers: { "user-agent": "ah (local coding agent harness)" }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!pic?.ok) continue;
    return {
      body: new Uint8Array(await pic.arrayBuffer()),
      credit: { title: (img.title ?? "").replace(/^File:/, "").replace(/\.\w+$/, ""), artist: (img.artist?.text ?? "unknown").split("\n")[0]!.trim().slice(0, 80), license: img.license?.type ?? "", url: img.file_page ?? full.source },
    };
  }
  throw new Error("no featured landscape photograph found in the last two weeks");
}
