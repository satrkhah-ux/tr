import { redirect } from "next/navigation";
import { ClientCommsAdmin } from "@/components/traveliun/operations/ClientCommsAdmin";
import { listDestinationGuides, listMessageTemplates } from "@/lib/data/destination-guides";
import { currentCan } from "@/lib/roles/current";
import { whatsappTemplateStatus } from "@/lib/providers/teletel";

export const dynamic = "force-dynamic";

/** Managers: the client's stage messages and the emergency guide per destination. */
export default async function ClientCommsPage() {
  if (!(await currentCan("settings.manage"))) redirect("/dashboard");
  const [templates, guides, wa] = await Promise.all([listMessageTemplates(), listDestinationGuides(), whatsappTemplateStatus()]);
  return <ClientCommsAdmin templates={templates} guides={guides} waStatus={wa ? Object.fromEntries(wa) : null} />;
}
