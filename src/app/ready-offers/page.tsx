import { getServerUser } from "@/lib/supabase/server";
import { listReadyOffers, readyOffersSheet } from "@/lib/data/ready-offers";
import { ReadyOffersCatalog } from "@/components/traveliun/ready-offers/ReadyOffersCatalog";
import { guardPath } from "@/lib/roles/current";

/**
 * «العروض الجاهزة» — the company's prepared seasonal packages.
 *
 * A real route, so it takes precedence over the generic table grid the
 * catch-all would otherwise render for /ready-offers.
 *
 * No session redirect here — the proxy already turns away requests with no
 * session cookie. What it cannot see is a cookie whose access token has gone
 * stale: PostgREST then answers as `anon`, RLS returns nothing, and the catalog
 * would render a lying "no packages" empty state. So the session is checked
 * once and reported honestly instead. Admin-only controls are hidden
 * client-side via useRole() and enforced inside the server actions.
 */
export default async function ReadyOffersPage() {
  // a service the developer can switch off (features.ts) — a typed URL is refused too
  await guardPath("/ready-offers");
  const user = await getServerUser();
  const [offers, sheet] = await Promise.all([user ? listReadyOffers(true) : [], readyOffersSheet()]);
  return <ReadyOffersCatalog offers={offers} sheetId={sheet.id} sessionExpired={!user} />;
}
