import "server-only";
import { AR } from "@/components/offer-doc/labels";
import { resolveDocBrand } from "@/lib/data/doc-brand";
import { getPublishedClientOffer } from "@/lib/data/offers";
import { renderOfferDocumentHtml } from "./html";
import { offerDocumentToPdf } from "./pdf";

/**
 * The client's programme PDF — the latest PUBLISHED snapshot, as the public
 * link /client-offer/[serial]/pdf serves it — kept a while once rendered.
 *
 * Chromium takes about five seconds. WhatsApp fetches a template's document
 * itself and gives up long before that («131053: Media upload error», the
 * programme never arrived), so the sender renders it first and Meta's fetch is
 * answered from here at once. A new version is a new key, so a re-issue is
 * never served the old document.
 */
const cache = new Map<string, { at: number; bytes: Uint8Array }>();
const KEEP_MS = 30 * 60_000;
const MAX = 20;

export async function clientOfferPdf(serial: string): Promise<Uint8Array | null> {
  const published = await getPublishedClientOffer(serial);
  if (!published) return null;
  const key = `${serial}:${published.version}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.bytes;

  // the public link follows the offer's OWN branding — nothing a URL can override
  const { brand, showPrices } = await resolveDocBrand({ serial });
  const html = await renderOfferDocumentHtml({ variant: "client", offer: published.offer, brand, showPrices });
  const pdf = await offerDocumentToPdf(html, {
    brand: brand.nameAr,
    serial,
    contact: brand.vars ? [brand.phone, brand.website].filter(Boolean).join(" · ") : AR.contact,
  });
  const bytes = new Uint8Array(pdf);
  cache.set(key, { at: Date.now(), bytes });
  // ponytail: oldest-first eviction at 20 entries (~15 MB); a real store if many issue at once
  while (cache.size > MAX) cache.delete(cache.keys().next().value as string);
  return bytes;
}
