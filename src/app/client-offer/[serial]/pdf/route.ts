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
// `?c=d`: the designed first page, the employee's choice at sending (the WhatsApp message carries that link); it names no label
export async function GET(request: Request, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const cover = new URL(request.url).searchParams.get("c") === "d" ? "designed" : "basic";
  const pdf = await clientOfferPdf(serial, cover);
  if (!pdf) return new Response("لم يتم نشر هذا العرض بعد", { status: 404 });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="offer-${serial}.pdf"`,
    },
  });
}
