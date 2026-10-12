import { redirect } from "next/navigation";
import { BasicEditor } from "@/components/traveliun/basic/BasicEditor";
import { getDraft, getGeneratorLookups } from "@/lib/data/drafts";
import { getProfitSettings } from "@/lib/data/app-settings";
import { currentCan } from "@/lib/roles/current";

export default async function BasicDraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  if (!(await currentCan("offers.write"))) redirect("/dashboard");
  const { draftId } = await params;
  const [draft, lookups, profitSettings] = await Promise.all([getDraft(draftId), getGeneratorLookups({ catalog: false }), getProfitSettings()]);
  if (!draft) redirect("/basic");
  return <BasicEditor draftId={draft.id} initialData={draft.data} savedAt={draft.updated_at} lookups={lookups} profitSettings={profitSettings} />;
}
