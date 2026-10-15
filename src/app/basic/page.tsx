import { redirect } from "next/navigation";
import { BasicHome } from "@/components/traveliun/basic/BasicHome";
import { listDrafts } from "@/lib/data/drafts";
import { listReadyOffers } from "@/lib/data/ready-offers";
import { currentCan } from "@/lib/roles/current";
import { getPartnerSession } from "@/lib/partners/session";
import { getCurrentEmployeeId } from "@/lib/data/metrics";

/** «تصميم بطاقة طيران» — set to its route once that page is live (null hides the button). */
const FLIGHT_CARD_HREF: string | null = "/repackage/flight-card";

/** «النظام بيسك» — the one-page entry over the same drafts as the package generator. */
export default async function BasicPage() {
  // our agents, and a partner company on its own files (the drafts and pricing already scope to it)
  if (!(await currentCan("offers.write")) && !(await getPartnerSession())) redirect("/dashboard");
  const [drafts, readyOffers, meId, canRepackage] = await Promise.all([
    listDrafts(),
    listReadyOffers(),
    getCurrentEmployeeId(),
    currentCan("repackage.write"),
  ]);
  return (
    <BasicHome
      drafts={drafts}
      meId={meId}
      readyOffers={readyOffers.filter((o) => o.status !== "coming_soon" && o.seed)}
      tools={{ repackage: canRepackage, flightCard: FLIGHT_CARD_HREF && canRepackage ? FLIGHT_CARD_HREF : null }}
    />
  );
}
