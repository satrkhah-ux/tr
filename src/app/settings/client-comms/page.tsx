import { redirect } from "next/navigation";
import { ClientCommsAdmin } from "@/components/traveliun/operations/ClientCommsAdmin";
import { listDestinationGuides, listMessageTemplates } from "@/lib/data/destination-guides";
import { currentCan } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** Managers: the client's stage messages and the emergency guide per destination. */
export default async function ClientCommsPage() {
  if (!(await currentCan("settings.manage"))) redirect("/dashboard");
  const [templates, guides] = await Promise.all([listMessageTemplates(), listDestinationGuides()]);
  return <ClientCommsAdmin templates={templates} guides={guides} />;
}
