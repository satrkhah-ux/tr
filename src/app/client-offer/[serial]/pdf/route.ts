import { coverFromParam } from "@/lib/data/offer-cover";
import { clientOfferPdf } from "@/lib/offer-doc/client-pdf";

export const runtime = "nodejs";
// Headless-Chromium cold start + render can exceed the default 10s; give it room.
export const maxDuration = 26;

/**
 * PUBLIC client PDF — the exact document that was sent. It renders the LATEST
 * PUBLISHED client snapshot (offer_renders, variant='client'), so the downloaded
 * PDF always matches the /client-offer/[serial] page and never changes when the
 * underlying data is edited later. No auth: it only exposes the already-redacted
 * client snapshot (never buy price / profit). Rendered once per version and kept
 * a while (client-pdf.ts) — WhatsApp fetches it for the programme template.
 */
// the first page is the employee's stored choice for the offer (offers.pdf_cover); `?c=d` / `?c=b` name one outright. No label is ever printed
export async function GET(request: Request, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const cover = await coverFromParam(serial, new URL(request.url).searchParams.get("c"));
  const pdf = await clientOfferPdf(serial, cover);
  if (!pdf) return new Response("لم يتم نشر هذا العرض بعد", { status: 404 });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="offer-${serial}.pdf"`,
    },
  });
}
