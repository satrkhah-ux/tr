import { redirect } from "next/navigation";
import { ExpensesView } from "@/components/traveliun/accounts/Expenses";
import { listExpenses } from "@/lib/data/accounts";
import { riyadhDate } from "@/lib/operations/payments";

export const dynamic = "force-dynamic";

/** «المصروفات» — the company's spending outside the trips (finance.accounts; the loader checks). */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const data = await listExpenses((await searchParams).month);
  if (!data) redirect("/dashboard");
  return <ExpensesView data={data} today={riyadhDate()} />;
}
