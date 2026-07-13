import { redirect } from "next/navigation";
import { getDraft, getGeneratorLookups } from "@/lib/data/drafts";
import type { StageKey } from "@/lib/offer/draft-types";
import { GeneratorShell } from "./GeneratorShell";

/**
 * Server wrapper shared by every /package-generator/[draftId]/<stage> page:
 * loads the persisted draft (deep-link + refresh safe) and the reference
 * lookups, then hands off to the client shell. Auth is enforced by middleware;
 * an unknown draft id goes back to the drafts list.
 */
export async function GeneratorStagePage({ draftId, stage }: { draftId: string; stage: StageKey }) {
  const [draft, lookups] = await Promise.all([getDraft(draftId), getGeneratorLookups()]);
  if (!draft) redirect("/package-generator");
  return <GeneratorShell draftId={draft.id} stage={stage} initialData={draft.data} lookups={lookups} />;
}
