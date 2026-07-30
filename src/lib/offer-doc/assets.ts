import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { OfferDocAssets } from "@/components/offer-doc/assets";

/**
 * The offer document's two images — the company logo and the world-map page
 * background — as base64 data URIs.
 *
 * Chromium prints the PDF from `setContent` with no base URL and no network, so
 * a `/traveliun/…` path would render as a broken image. The browser preview
 * keeps using those paths (see components/offer-doc/assets.ts); only the print
 * pipeline inlines the bytes.
 */
const FILES = {
  logoUrl: "public/traveliun/offer-logo.png",
  mapUrl: "public/traveliun/world-map.png",
} as const;

/** A logo that large is a mistake, not a logo — and it would bloat every PDF. */
const MAX_INLINE_BYTES = 3 * 1024 * 1024;

/**
 * Fetch an image and return it as a data URI, or null if it cannot be had.
 *
 * A partner's logo lives in Supabase Storage, so the printed document needs the
 * BYTES: Chromium prints from `setContent` with no network, and a `https://…`
 * src would render as a broken image on the cover.
 *
 * The URL is always one we built ourselves (our storage origin + a path this app
 * generated), never a partner-supplied address — which is what keeps a
 * server-side fetch from being an SSRF hole.
 */
export async function inlineImage(url: string): Promise<string | null> {
  if (url.startsWith("data:")) return url;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_INLINE_BYTES) return null;
    const type = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    if (!type.startsWith("image/")) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

let cache: OfferDocAssets | null = null;

export async function loadOfferDocAssets(): Promise<OfferDocAssets> {
  if (cache) return cache;
  const [logo, map] = await Promise.all([
    readFile(join(process.cwd(), FILES.logoUrl)),
    readFile(join(process.cwd(), FILES.mapUrl)),
  ]);
  cache = {
    logoUrl: `data:image/png;base64,${logo.toString("base64")}`,
    mapUrl: `data:image/png;base64,${map.toString("base64")}`,
  };
  return cache;
}
