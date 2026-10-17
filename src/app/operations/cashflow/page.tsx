import { notFound, redirect } from "next/navigation";
import { CashflowView } from "@/components/traveliun/operations/MoneyReports";
import { getCashflow } from "@/lib/data/operation-money";
import { gateManager } from "@/lib/operations/access";

export const dynamic = "force-dynamic";

/** «التدفق النقدي» — the next eight weeks of money in and out. pricing.internal (the loader checks). */
export default async function CashflowPage() {
  // the reports across every case are the manager's: an own-files holder goes back to their board
  if (await gateManager()) redirect("/operations");
  const cashflow = await getCashflow();
  if (!cashflow) notFound();
  return <CashflowView cashflow={cashflow} />;
}
