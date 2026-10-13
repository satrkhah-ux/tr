import { getOfferBySerial } from "@/lib/data/offers";
import { buildOfferImage } from "@/lib/offer-image";
import { getPartnerSession } from "@/lib/partners/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 26;

export async function GET(_request: Request, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const offer = await getOfferBySerial(serial);
  if (!offer) return new Response("العرض غير متاح", { status: 404 });
  // A partner's image follows the file's own flag, as the PDF does: priced for
  // their own file, unpriced for one we built for them (that total is our sell).
  if (await getPartnerSession()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("offers").select("show_prices").eq("serial", serial).maybeSingle();
    if (!(data as { show_prices: boolean } | null)?.show_prices) return buildOfferImage({ ...offer, total: null });
  }
  return buildOfferImage(offer);
}
