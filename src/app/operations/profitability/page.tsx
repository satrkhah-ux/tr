import { notFound, redirect } from "next/navigation";
import { ProfitabilityReport } from "@/components/traveliun/operations/MoneyReports";
import { getProfitReport } from "@/lib/data/operation-money";
import { gateManager } from "@/lib/operations/access";

export const dynamic = "force-dynamic";

/** «تقرير الربحية» — per month, employee and destination. pricing.internal (the loader checks). */
export default async function ProfitabilityPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  // the reports across every case are the manager's: an own-files holder goes back to their board
  if (await gateManager()) redirect("/operations");
  const report = await getProfitReport(await searchParams);
  if (!report) notFound();
  return <ProfitabilityReport report={report} />;
}
