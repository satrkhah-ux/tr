import { notFound } from "next/navigation";
import { ProfitabilityReport } from "@/components/traveliun/operations/MoneyReports";
import { getProfitReport } from "@/lib/data/operation-money";

export const dynamic = "force-dynamic";

/** «تقرير الربحية» — per month, employee and destination. pricing.internal (the loader checks). */
export default async function ProfitabilityPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const report = await getProfitReport(await searchParams);
  if (!report) notFound();
  return <ProfitabilityReport report={report} />;
}
