import { TraveliunDashboardClient } from "@/components/traveliun/TraveliunDashboardClient";
import { getOperationsSummary } from "@/lib/data/operations-work";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Fetched on the server so the operations numbers are already on screen at
  // first paint, and so "travel is approaching" is measured against the server's
  // clock rather than the visitor's laptop.
  const opsSummary = await getOperationsSummary();
  return <TraveliunDashboardClient opsSummary={opsSummary} />;
}
