import { AR } from "@/components/offer-doc/labels";
import { resolveDocBrand } from "@/lib/data/partner-companies";
import type { OfferDocumentProps } from "@/components/offer-doc/OfferDocument";
import { getInternalOffer, getPublishedClientOffer } from "@/lib/data/offers";
import { toClientOfferDTO } from "@/lib/offer/dto";
import { renderOfferDocumentHtml } from "@/lib/offer-doc/html";
import { offerDocumentToPdf } from "@/lib/offer-doc/pdf";
import { currentCan } from "@/lib/roles/current";

export const runtime = "nodejs";
// Headless-Chromium cold start + render can exceed the default 10s; give it room.
export const maxDuration = 26;

/**
 * Staff PDF (authenticated — /offer/* is behind the auth gate).
 *   ?variant=internal  → full buy/sell/profit document, gated on pricing.internal.
 *   ?brand=<partnerId>  → issued under a partner company's name, logo and colours.
 *   ?prices=off         → no money on the page at all (a reseller adds their own).
 *   (default)          → client document: the published snapshot if any, else a
 *                        live client render (so staff can preview before sending).
 * The PUBLIC client download is /client-offer/[serial]/pdf.
 */
export async function GET(request: Request, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const query = new URL(request.url).searchParams;
  const wantsInternal = query.get("variant") === "internal";
  const brandParam = query.get("brand");
  const pricesParam = query.get("prices");

  let props: OfferDocumentProps;
  if (wantsInternal) {
    if (!await currentCan("pricing.internal")) return new Response("غير مصرح بعرض التسعير الداخلي", { status: 403 });
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

  // `brand=ours` forces our identity even when the offer is tied to a partner;
  // no param at all falls back to whatever the offer was branded for.
  const { brand, showPrices } = await resolveDocBrand({
    serial,
    partnerId: brandParam === "ours" ? null : brandParam,
    showPrices: pricesParam == null ? undefined : pricesParam !== "off",
  });

  const html = await renderOfferDocumentHtml({ ...props, brand, showPrices });
  const pdf = await offerDocumentToPdf(html, {
    brand: brand.nameAr,
    serial,
    contact: brand.vars ? [brand.phone, brand.website].filter(Boolean).join(" · ") : AR.contact,
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="offer-${serial}${wantsInternal ? "-internal" : ""}.pdf"`,
    },
  });
}
