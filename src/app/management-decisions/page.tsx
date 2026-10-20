import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { ManagementDecisions } from "@/components/traveliun/settings/ManagementDecisions";
import { getManagementDecisions } from "@/lib/data/management-decisions";

export default async function ManagementDecisionsPage() {
  const data = await getManagementDecisions();
  if (!data) redirect("/dashboard");
  return <TraveliunShell title="nav.managementDecisions"><ManagementDecisions initial={data} /></TraveliunShell>;
}
