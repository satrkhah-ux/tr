import { redirect } from "next/navigation";
import { DraftsList } from "@/components/traveliun/generator/DraftsList";
import { listDrafts } from "@/lib/data/drafts";
import { getPartnerSession } from "@/lib/partners/session";

/** Package generator home: the offer drafts list. Each draft edits in
 *  independent, deep-linkable stage pages under /package-generator/[draftId]/*. */
export default async function PackageGeneratorPage() {
  // the legacy generator switched off (/developer): staff start in «بيسك»; a
  // partner keeps this list — it is their «ملفاتي» ([draftId]/layout.tsx says the same)
  // the owner (2026-10-17): all work is on «بيسك» — staff use its files list whatever the switch says
  if (!(await getPartnerSession())) redirect("/basic");
  const drafts = await listDrafts();
  return <DraftsList drafts={drafts} />;
}
