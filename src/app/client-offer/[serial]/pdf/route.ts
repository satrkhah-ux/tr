import { AR } from "@/components/offer-doc/labels";
import { getPublishedClientOffer } from "@/lib/data/offers";
import { renderOfferDocumentHtml } from "@/lib/offer-doc/html";
import { offerDocumentToPdf } from "@/lib/offer-doc/pdf";

export const runtime = "nodejs";
// Headless-Chromium cold start + render can exceed the default 10s; give it room.
export const maxDuration = 26;

/**
 * PUBLIC client PDF — the exact document that was sent. It renders the LATEST
 * PUBLISHED client snapshot (offer_renders, variant='client'), so the downloaded
 * PDF always matches the /client-offer/[serial] page and never changes when the
 * underlying data is edited later. No auth: it only exposes the already-redacted
 * client snapshot (never buy price / profit).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const published = await getPublishedClientOffer(serial);
  if (!published) return new Response("لم يتم نشر هذا العرض بعد", { status: 404 });

  const html = await renderOfferDocumentHtml({ variant: "client", offer: published.offer });
  const pdf = await offerDocumentToPdf(html, { brand: AR.brand, serial, contact: AR.contact });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="offer-${serial}.pdf"`,
    },
  });
}
