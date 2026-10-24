import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { ManagementDecisions } from "@/components/traveliun/settings/ManagementDecisions";
import { MuradStaffRules } from "@/components/traveliun/settings/MuradStaffRules";
import { getManagementDecisions } from "@/lib/data/management-decisions";
import { getMuradStaffRules } from "@/lib/data/murad-staff-rules";

export default async function ManagementDecisionsPage() {
  const [data, rules] = await Promise.all([getManagementDecisions(), getMuradStaffRules()]);
  if (!data || !rules) redirect("/dashboard");
  return <TraveliunShell title="nav.managementDecisions">
    <div dir="rtl" className="space-y-8 text-[#185045]">
      <ManagementDecisions initial={data} />
      <MuradStaffRules initial={rules} />
    </div>
  </TraveliunShell>;
}
