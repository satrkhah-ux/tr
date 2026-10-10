import { redirect } from "next/navigation";
import { getDraft, getGeneratorLookups } from "@/lib/data/drafts";
import { GeneratorFlow } from "@/components/traveliun/generator/GeneratorFlow";

/**
 * A draft, as one page of cards.
 *
 * This used to be a bare redirect to /customer, which is why every caller that
 * opened a draft picked its own entry stage and they disagreed with each other.
 * The canonical address now renders the whole file; the eleven stage routes
 * stay live behind it, for deep-linked validation issues and as the fallback.
 */
export default async function Page({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  const [draft, lookups] = await Promise.all([getDraft(draftId), getGeneratorLookups()]);
  if (!draft) redirect("/package-generator");
  return <GeneratorFlow draftId={draft.id} initialData={draft.data} lookups={lookups} />;
}
