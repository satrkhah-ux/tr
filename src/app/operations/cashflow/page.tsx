import { notFound } from "next/navigation";
import { CashflowView } from "@/components/traveliun/operations/MoneyReports";
import { getCashflow } from "@/lib/data/operation-money";

export const dynamic = "force-dynamic";

/** «التدفق النقدي» — the next eight weeks of money in and out. pricing.internal (the loader checks). */
export default async function CashflowPage() {
  const cashflow = await getCashflow();
  if (!cashflow) notFound();
  return <CashflowView cashflow={cashflow} />;
}
