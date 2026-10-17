import { redirect } from "next/navigation";
import { LeadsBoard } from "@/components/traveliun/leads/LeadsBoard";
import { listLeads } from "@/lib/data/leads";

/** «العملاء» — every client conversation, open to every employee (partners have no employee row, so no page). */
export default async function ClientsPage() {
  const page = await listLeads();
  if (!page.meId) redirect("/dashboard");
  return <LeadsBoard {...page} />;
}
