import { redirect } from "next/navigation";
import { DraftsList } from "@/components/traveliun/generator/DraftsList";
import { listDrafts } from "@/lib/data/drafts";
import { featureOn } from "@/lib/features-server";
import { getPartnerSession } from "@/lib/partners/session";

/** Package generator home: the offer drafts list. Each draft edits in
 *  independent, deep-linkable stage pages under /package-generator/[draftId]/*. */
export default async function PackageGeneratorPage() {
  // the legacy generator switched off (/developer): staff start in «بيسك»; a
  // partner keeps this list — it is their «ملفاتي» ([draftId]/layout.tsx says the same)
  if (!(await featureOn("legacy_generator")) && !(await getPartnerSession())) redirect("/basic");
  const drafts = await listDrafts();
  return <DraftsList drafts={drafts} />;
}
