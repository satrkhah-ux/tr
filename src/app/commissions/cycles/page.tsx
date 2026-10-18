import { redirect } from "next/navigation";
import { CycleBoard } from "@/components/traveliun/commissions/CycleBoard";
import { getCycleView } from "@/lib/data/commissions";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** «دورة العمولات» — commissions.manage / commissions.approve. */
export default async function CommissionCyclesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await guardPath("/commissions/cycles");
  const view = await getCycleView((await searchParams).month);
  if (!view) redirect("/commissions");
  return <CycleBoard view={view} />;
}
