import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { FinanceBookView } from "@/components/traveliun/finance/FinanceBookView";
import { FinanceLock } from "@/components/traveliun/finance/FinanceLock";
import { getFinance } from "@/lib/data/finance";

export default async function FinancePage() {
  const data = await getFinance();
  if (!data) redirect("/dashboard");
  return <TraveliunShell title="nav.finance">
    {"locked" in data ? <FinanceLock mode={data.locked} />
      : "book" in data ? <FinanceBookView initial={data.book} />
      : <p dir="rtl" className="rounded-2xl border bg-white p-5 text-[#185045]">{data.error}</p>}
  </TraveliunShell>;
}
