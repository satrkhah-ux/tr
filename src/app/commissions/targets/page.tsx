import { redirect } from "next/navigation";
import { TargetsEditor } from "@/components/traveliun/commissions/TargetsEditor";
import { getTargetsView } from "@/lib/data/commissions";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** «أهداف المبيعات» — commissions.manage. */
export default async function SalesTargetsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await guardPath("/commissions/targets");
  const view = await getTargetsView((await searchParams).month);
  if (!view) redirect("/commissions");
  return <TargetsEditor view={view} />;
}
