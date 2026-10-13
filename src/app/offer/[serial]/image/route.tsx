import { getOfferBySerial } from "@/lib/data/offers";
import { buildOfferImage } from "@/lib/offer-image";
import { getPartnerSession } from "@/lib/partners/session";

export const runtime = "nodejs";
export const maxDuration = 26;

export async function GET(_request: Request, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const offer = await getOfferBySerial(serial);
  if (!offer) return new Response("العرض غير متاح", { status: 404 });
  // the stored total is our sell: a partner's image goes without it
  return buildOfferImage((await getPartnerSession()) ? { ...offer, total: null } : offer);
}
