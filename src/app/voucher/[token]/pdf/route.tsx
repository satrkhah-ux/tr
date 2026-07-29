import { NextResponse } from "next/server";
import { VoucherDocument } from "@/components/offer-doc/VoucherDocument";
import { renderDocHtml } from "@/lib/offer-doc/html";
import { offerDocumentToPdf } from "@/lib/offer-doc/pdf";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { VoucherDTO } from "@/lib/operations/voucher-dto";

export const runtime = "nodejs";
export const maxDuration = 26;

/**
 * The voucher a traveller carries.
 *
 * THE TOKEN IS THE GATE. It is validated here, in code, through the service-role
 * client — RLS cannot see a URL, and an anon policy would expose every voucher
 * to anyone holding the anon key.
 *
 * This is deliberately unlike /client-offer/[serial]/pdf, which is public on
 * purpose: that snapshot is structurally redacted by toClientOfferDTO, so a
 * guessable serial costs nothing. A voucher cannot be redacted — it carries the
 * guest names and the supplier's confirmation number, which is exactly what
 * would let a stranger check in as your client. Hence 24 random bytes rather
 * than a serial, and a revoked_at that kills the link instantly.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("operation_documents")
    .select("snapshot_json, revoked_at")
    .eq("token", token)
    .maybeSingle();

  const row = data as { snapshot_json: VoucherDTO; revoked_at: string | null } | null;
  if (!row || row.revoked_at) {
    return new NextResponse("Not found", { status: 404 });
  }

  const html = await renderDocHtml((assets) => <VoucherDocument voucher={row.snapshot_json} assets={assets} />);
  const pdf = await offerDocumentToPdf(html);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${row.snapshot_json.kind}-${row.snapshot_json.serial}.pdf"`,
      // never cached by a shared proxy, never indexed
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
