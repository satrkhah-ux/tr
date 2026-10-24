import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { FinanceBookView } from "@/components/traveliun/finance/FinanceBookView";
import { getFinance } from "@/lib/data/finance";

export default async function FinancePage() {
  const data = await getFinance();
  if (!data) redirect("/dashboard");
  return <TraveliunShell title="nav.finance">
    {data.book ? <FinanceBookView initial={data.book} /> : <p dir="rtl" className="rounded-2xl border bg-white p-5 text-[#185045]">{data.error}</p>}
  </TraveliunShell>;
}
