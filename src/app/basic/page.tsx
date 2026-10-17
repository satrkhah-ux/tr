import { redirect } from "next/navigation";
import { BasicHome } from "@/components/traveliun/basic/BasicHome";
import { listDrafts } from "@/lib/data/drafts";
import { listReadyOffers } from "@/lib/data/ready-offers";
import { currentCan, currentCanOpen } from "@/lib/roles/current";
import { getPartnerSession } from "@/lib/partners/session";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { fileStatesFor } from "@/lib/data/file-status-core";

/** «تصميم بطاقة طيران» — set to its route once that page is live (null hides the button). */
const FLIGHT_CARD_HREF: string | null = "/repackage/flight-card";

/** «النظام بيسك» — the one-page entry over the same drafts as the package generator. */
export default async function BasicPage({ searchParams }: { searchParams: Promise<{ files?: string }> }) {
  const { files } = await searchParams;
  // our agents, and a partner company on its own files (the drafts and pricing already scope to it)
  if (!(await currentCan("offers.write")) && !(await getPartnerSession())) redirect("/dashboard");
  // the doors to the other services follow their switches (features.ts) as the menu does
  const [drafts, readyOffers, meId, canRepackage, management, repackageOn, flightCardOn] = await Promise.all([
    listDrafts(),
    currentCanOpen("/ready-offers").then((on) => (on ? listReadyOffers() : [])),
    getCurrentEmployeeId(),
    currentCan("repackage.write"),
    // the administration opens on everyone's files; an agent on their own
    currentCan("dashboard.admin"),
    currentCanOpen("/repackage"),
    currentCanOpen("/repackage/flight-card"),
  ]);
  // where each issued file stands — staff only (a partner follows theirs in the partner portal)
  const states = meId ? await fileStatesFor(drafts) : {};
  return (
    <BasicHome
      drafts={drafts}
      states={states}
      meId={meId}
      allByDefault={management}
      initialTab={files === "issued" || files === "draft" ? files : "all"}
      readyOffers={readyOffers.filter((o) => o.status !== "coming_soon" && o.seed)}
      tools={{ repackage: canRepackage && repackageOn, flightCard: FLIGHT_CARD_HREF && canRepackage && flightCardOn ? FLIGHT_CARD_HREF : null }}
    />
  );
}
