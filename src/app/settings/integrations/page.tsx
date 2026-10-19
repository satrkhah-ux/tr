import { redirect } from "next/navigation";
import { IntegrationsAdmin } from "@/components/traveliun/developer/IntegrationsAdmin";
import { listIntegrations } from "@/lib/data/integrations";
import { guardPath } from "@/lib/roles/current";

/** «الربط الخارجي» — a tab of «المطوّر», for settings.manage (the owner, 2026-10-19). */
export default async function IntegrationsPage() {
  await guardPath("/settings/integrations");
  const rows = await listIntegrations();
  if (!rows) redirect("/dashboard");
  return <IntegrationsAdmin rows={rows} />;
}
