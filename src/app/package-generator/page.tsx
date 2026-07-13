import { DraftsList } from "@/components/traveliun/generator/DraftsList";
import { listDrafts } from "@/lib/data/drafts";

/** Package generator home: the offer drafts list. Each draft edits in
 *  independent, deep-linkable stage pages under /package-generator/[draftId]/*. */
export default async function PackageGeneratorPage() {
  const drafts = await listDrafts();
  return <DraftsList drafts={drafts} />;
}
