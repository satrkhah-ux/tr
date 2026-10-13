import { NextResponse } from "next/server";
import { TravelPackDocument } from "@/components/offer-doc/TravelPackDocument";
import { getTravelPack } from "@/lib/data/travel-pack";
import { renderDocHtml } from "@/lib/offer-doc/html";
import { inlineImage } from "@/lib/offer-doc/assets";
import { resolveDocBrand } from "@/lib/data/partner-companies";
import { offerDocumentToPdf } from "@/lib/offer-doc/pdf";

export const runtime = "nodejs";
export const maxDuration = 26;

/**
 * «حقيبة السفر» — every client document of the trip in one PDF.
 *
 * Under /trip so the proxy lets it through like the link itself; the token is
 * the gate, checked by the same readers the trip page uses (service role, a
 * revoked link is a 404). ONE html and ONE Chromium launch for the whole pack —
 * merging per-document PDFs would launch a browser per sheet and outrun the
 * function's time limit on a big trip.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pack = await getTravelPack(token);
  if (!pack) return new NextResponse("Not found", { status: 404 });

  // a partner's client carries the partner's documents — the pack too
  const resolved = (await resolveDocBrand({ serial: pack.hub.serial })).brand;
  // Chromium prints offline: a storage logo URL must be inlined or it prints a broken box
  const brand = resolved.logoUrl ? { ...resolved, logoUrl: (await inlineImage(resolved.logoUrl)) ?? null } : resolved;
  const html = await renderDocHtml((assets) => <TravelPackDocument pack={pack} assets={assets} brand={brand} />, brand.font);
  const pdf = await offerDocumentToPdf(html);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="travel-pack-${pack.hub.serial}.pdf"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
