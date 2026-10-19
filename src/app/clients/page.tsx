import { redirect } from "next/navigation";
import { LeadsBoard } from "@/components/traveliun/leads/LeadsBoard";
import { listLeads } from "@/lib/data/leads";
import { guardPath } from "@/lib/roles/current";

/** «العملاء» — every client conversation, open to every employee (partners have no employee row, so no page). */
export default async function ClientsPage() {
  await guardPath("/clients");
  const page = await listLeads();
  if (!page.meId) redirect("/dashboard");
  return <LeadsBoard {...page} />;
}
