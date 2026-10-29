import { getInternalOffer, getPublishedClientOffer } from "@/lib/data/offers";
import { resolveDocBrand } from "@/lib/data/doc-brand";
import { toClientOfferDTO } from "@/lib/offer/dto";
import { renderOfferDocumentHtml } from "@/lib/offer-doc/html";
import { documentToPng } from "@/lib/offer-doc/pdf";

export const runtime = "nodejs";
export const maxDuration = 26;

/**
 * Staff: the client document's FIRST page as a picture, in the cover named by `?c=d` (فني) or `?c=b` (أساسي) — the
 * small live preview beside the choice (the /offer/* gate keeps it to staff). Same HTML as the PDF, so it cannot drift.
 */
export async function GET(request: Request, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const cover = new URL(request.url).searchParams.get("c") === "d" ? "designed" : "basic";
  const published = await getPublishedClientOffer(serial);
  const internal = published ? null : await getInternalOffer(serial);
  const offer = published?.offer ?? (internal ? toClientOfferDTO(internal) : null);
  if (!offer) return new Response("العرض غير متاح", { status: 404 });
  const { brand, showPrices } = await resolveDocBrand({ serial });
  const html = await renderOfferDocumentHtml({ variant: "client", offer, brand, showPrices, ...(cover === "designed" ? { cover } : {}) });
  const png = await documentToPng(html);
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=60" } });
}
