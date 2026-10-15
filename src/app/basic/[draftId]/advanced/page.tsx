import { redirect } from "next/navigation";
import { AdvancedEditor } from "@/components/traveliun/basic/AdvancedEditor";
import { getDraft, getGeneratorLookups } from "@/lib/data/drafts";
import { currentCan } from "@/lib/roles/current";
import { getPartnerSession } from "@/lib/partners/session";

/** «البكج المتقدم» — the same draft as /basic/[draftId], its composite-route slice. */
export default async function AdvancedPackagePage({ params }: { params: Promise<{ draftId: string }> }) {
  if (!(await currentCan("offers.write")) && !(await getPartnerSession())) redirect("/dashboard");
  const { draftId } = await params;
  const [draft, lookups] = await Promise.all([getDraft(draftId), getGeneratorLookups({ catalog: false })]);
  if (!draft) redirect("/basic");
  return <AdvancedEditor draftId={draft.id} initialData={draft.data} savedAt={draft.updated_at} lookups={lookups} />;
}
