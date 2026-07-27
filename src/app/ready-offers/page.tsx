import { getServerUser } from "@/lib/supabase/server";
import { listReadyOffers } from "@/lib/data/ready-offers";
import { ReadyOffersCatalog } from "@/components/traveliun/ready-offers/ReadyOffersCatalog";

/**
 * «العروض الجاهزة» — the company's prepared seasonal packages.
 *
 * A real route, so it takes precedence over the generic table grid the
 * catch-all would otherwise render for /ready-offers.
 *
 * No redirect guard here — the proxy already turns away requests with no
 * session cookie. What it cannot see is a cookie whose access token has gone
 * stale: PostgREST then answers as `anon`, RLS returns nothing, and the catalog
 * would render a lying "no packages" empty state. So the session is checked
 * once and reported honestly instead. Admin-only controls are hidden
 * client-side via useRole() and enforced inside the server actions.
 */
export default async function ReadyOffersPage() {
  const user = await getServerUser();
  const offers = user ? await listReadyOffers(true) : [];
  return <ReadyOffersCatalog offers={offers} sessionExpired={!user} />;
}
