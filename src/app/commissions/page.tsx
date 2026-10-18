import { redirect } from "next/navigation";
import { MyCommission } from "@/components/traveliun/commissions/MyCommission";
import { getMyCommission } from "@/lib/data/commissions";
import { currentCan, guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** «عمولتي» — commissions.view (section-access.ts, and the loader again); the employee's own figures only. */
export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await guardPath("/commissions");
  const [data, manage, approve] = await Promise.all([getMyCommission((await searchParams).month), currentCan("commissions.manage"), currentCan("commissions.approve")]);
  if (!data) redirect(manage || approve ? "/commissions/cycles" : "/dashboard");
  return <MyCommission data={data} manage={manage || approve} />;
}
