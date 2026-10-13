"use server";

import { getServerUser } from "@/lib/supabase/server";
import { loadDraft } from "./draft-store";
import { suggestPricingFor, type SuggestPricingResult } from "./pricing-suggest-core";

export type { SuggestPricingResult } from "./pricing-suggest-core";

/** The pricing sheet for a draft the caller may open — see suggestPricingFor. */
export async function suggestPricingForDraft(
  draftId: string,
  labels: { hotel: string; airline: string },
): Promise<SuggestPricingResult> {
  if (!(await getServerUser())) return { ok: false, error: "err.session" };
  // The full draft: a supplier-priced stay's net is what its line is bought at.
  const record = await loadDraft(draftId);
  if (!record) return { ok: false, error: "err.db" };
  return suggestPricingFor(record, labels);
}
