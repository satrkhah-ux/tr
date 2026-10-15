import { redirect } from "next/navigation";
import { BasicEditor } from "@/components/traveliun/basic/BasicEditor";
import { getDraft, getGeneratorLookups } from "@/lib/data/drafts";
import { getProfitSettings } from "@/lib/data/app-settings";
import { withModelLookups } from "@/lib/data/model-lookups";
import { currentCan } from "@/lib/roles/current";
import { getPartnerSession } from "@/lib/partners/session";

export default async function BasicDraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  // our agents, and a partner company on its own files (the drafts and pricing already scope to it)
  if (!(await currentCan("offers.write")) && !(await getPartnerSession())) redirect("/dashboard");
  const { draftId } = await params;
  const [draft, lookups, profitSettings] = await Promise.all([getDraft(draftId), getGeneratorLookups({ catalog: false }).then(withModelLookups), getProfitSettings()]);
  if (!draft) redirect("/basic");
  return <BasicEditor draftId={draft.id} initialData={draft.data} savedAt={draft.updated_at} lookups={lookups} profitSettings={profitSettings} />;
}
