import { couponWith, site } from "@/lib/data/discounts";
import { couponCard } from "@/lib/discounts/card";

/** The coupon's landscape picture — the WhatsApp message's header (Meta fetches it by this URL). No session: the token is the key. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return new Response("not found", { status: 404 });
  const found = await couponWith({ token });
  if (!found || found.coupon.excluded) return new Response("not found", { status: 404 });
  const { coupon, campaign } = found;
  return couponCard({
    name: coupon.client_name,
    phone: coupon.phone,
    code: coupon.code,
    link: `${site()}/coupon/${token}`,
    kind: campaign.kind,
    value: campaign.value,
    applies_to: campaign.applies_to,
    expires_at: coupon.expires_at,
  });
}
