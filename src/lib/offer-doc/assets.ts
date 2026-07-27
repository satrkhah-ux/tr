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
