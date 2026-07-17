import { AR } from "@/components/offer-doc/labels";
import type { OfferDocumentProps } from "@/components/offer-doc/OfferDocument";
import { getInternalOffer, getPublishedClientOffer } from "@/lib/data/offers";
import { getCurrentRole } from "@/lib/data/metrics";
import { toClientOfferDTO } from "@/lib/offer/dto";
import { renderOfferDocumentHtml } from "@/lib/offer-doc/html";
import { offerDocumentToPdf } from "@/lib/offer-doc/pdf";
import { can } from "@/lib/roles/roles";

export const runtime = "nodejs";
// Headless-Chromium cold start + render can exceed the default 10s; give it room.
export const maxDuration = 26;

/**
 * Staff PDF (authenticated — /offer/* is behind the auth gate).
 *   ?variant=internal  → full buy/sell/profit document, gated on pricing.internal.
 *   (default)          → client document: the published snapshot if any, else a
 *                        live client render (so staff can preview before sending).
 * The PUBLIC client download is /client-offer/[serial]/pdf.
 */
export async function GET(request: Request, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const wantsInternal = new URL(request.url).searchParams.get("variant") === "internal";

  let props: OfferDocumentProps;
  if (wantsInternal) {
    const role = await getCurrentRole();
    if (!can(role, "pricing.internal")) return new Response("غير مصرح بعرض التسعير الداخلي", { status: 403 });
    const internal = await getInternalOffer(serial);
    if (!internal) return new Response("العرض غير متاح", { status: 404 });
    props = { variant: "internal", offer: internal };
  } else {
    const published = await getPublishedClientOffer(serial);
    if (published) {
      props = { variant: "client", offer: published.offer };
    } else {
      const internal = await getInternalOffer(serial);
      if (!internal) return new Response("العرض غير متاح", { status: 404 });
      props = { variant: "client", offer: toClientOfferDTO(internal) };
    }
  }

  const html = await renderOfferDocumentHtml(props);
  const pdf = await offerDocumentToPdf(html, { brand: AR.brand, serial, contact: AR.contact });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="offer-${serial}${wantsInternal ? "-internal" : ""}.pdf"`,
    },
  });
}
