import { getOfferBySerial } from "@/lib/data/offers";
import { buildOfferImage } from "@/lib/offer-image";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const offer = await getOfferBySerial(serial);
  if (!offer) return new Response("العرض غير متاح", { status: 404 });
  return buildOfferImage(offer);
}
