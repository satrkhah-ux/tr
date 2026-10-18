import { redirect } from "next/navigation";
import { PolicyEditor } from "@/components/traveliun/commissions/PolicyEditor";
import { getPolicyView } from "@/lib/data/commissions";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** «سياسة العمولة» — commissions.manage writes a draft, commissions.approve (someone else) approves it. */
export default async function CommissionPolicyPage() {
  await guardPath("/commissions/policy");
  const view = await getPolicyView();
  if (!view) redirect("/commissions");
  return <PolicyEditor view={view} />;
}
