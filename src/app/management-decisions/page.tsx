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
      {/* folded behind its top button so the page stays short (the owner, 2026-10-24) */}
      <MuradStaffRules initial={rules} />
      <ManagementDecisions initial={data} />
    </div>
  </TraveliunShell>;
}
