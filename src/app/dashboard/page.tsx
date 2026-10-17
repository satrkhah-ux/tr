import { TraveliunDashboardClient } from "@/components/traveliun/TraveliunDashboardClient";
import { getOperationsSummary } from "@/lib/data/operations-work";
import { getMyDashboard } from "@/lib/data/my-dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Fetched on the server so the operations numbers are already on screen at
  // first paint, and so "travel is approaching" is measured against the server's
  // clock rather than the visitor's laptop. «لوحتي» likewise: the employee is
  // read from the session here, so the browser never names whose numbers to show.
  const [opsSummary, mine] = await Promise.all([getOperationsSummary(), getMyDashboard()]);
  return <TraveliunDashboardClient opsSummary={opsSummary} mine={mine} />;
}
