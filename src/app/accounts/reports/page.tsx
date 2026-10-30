import { redirect } from "next/navigation";
import { ReportsPage } from "@/components/traveliun/accounts/Reports";
import { getReports } from "@/lib/data/accounts";

export const dynamic = "force-dynamic";

/** «التقارير المالية» — who owes, whom we pay most, each employee's results (finance.accounts; the loader checks). */
export default async function AccountsReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const r = await getReports((await searchParams).period);
  if (!r) redirect("/dashboard");
  return <ReportsPage r={r} />;
}
