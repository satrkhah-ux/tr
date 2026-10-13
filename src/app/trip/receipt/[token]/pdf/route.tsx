import { NextResponse } from "next/server";
import { ReceiptDocument } from "@/components/offer-doc/ReceiptDocument";
import { getReceiptByToken } from "@/lib/data/payment-receipt";
import { renderDocHtml } from "@/lib/offer-doc/html";
import { inlineImage } from "@/lib/offer-doc/assets";
import { resolveDocBrand } from "@/lib/data/partner-companies";
import { offerDocumentToPdf } from "@/lib/offer-doc/pdf";

export const runtime = "nodejs";
export const maxDuration = 26;

/**
 * «سند قبض» — one payment's receipt, for the client.
 *
 * Under /trip so it is public the way the client's link is (the proxy lets
 * /trip through), and gated the way a voucher is: the 24-byte token is checked
 * here through the service role. Deleting the payment kills the link.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const receipt = await getReceiptByToken(token);
  if (!receipt) return new NextResponse("Not found", { status: 404 });

  // a partner's client paid the partner — its name and colours, not ours
  const resolved = (await resolveDocBrand({ serial: receipt.serial })).brand;
  // Chromium prints offline: a storage logo URL must be inlined or it prints a broken box
  const brand = resolved.logoUrl ? { ...resolved, logoUrl: (await inlineImage(resolved.logoUrl)) ?? null } : resolved;
  const html = await renderDocHtml((assets) => <ReceiptDocument receipt={receipt} assets={assets} brand={brand} />, brand.font);
  const pdf = await offerDocumentToPdf(html);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="receipt-${receipt.receipt_no}.pdf"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
