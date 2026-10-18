import { TraveliunDashboardClient } from "@/components/traveliun/TraveliunDashboardClient";
import { getOperationsSummary } from "@/lib/data/operations-work";
import { getMyDashboard } from "@/lib/data/my-dashboard";
import { getLatestOffer } from "@/lib/data/offers";
import { currentCan } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Fetched on the server so the operations numbers are already on screen at
  // first paint, and so "travel is approaching" is measured against the server's
  // clock rather than the visitor's laptop. «لوحتي» likewise: the employee is
  // read from the session here, so the browser never names whose numbers to show.
  // the latest offer, its smart check and client link (the old «مركز التشغيل الذكي») — the administration's
  const [opsSummary, mine, latest] = await Promise.all([
    getOperationsSummary(),
    getMyDashboard(),
    currentCan("dashboard.admin").then((on) => (on ? getLatestOffer() : null)),
  ]);
  return <TraveliunDashboardClient opsSummary={opsSummary} mine={mine} latest={latest} />;
}
