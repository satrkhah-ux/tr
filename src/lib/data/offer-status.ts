import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import type { OfferStatus } from "@/lib/types";

/**
 * The one place an offer's status changes.
 *
 * NOT a "use server" module: it takes a SupabaseClient, so it must never become
 * a callable action endpoint. It was a file-private helper inside offers.ts,
 * which is why nothing outside publishing could record a status change — and
 * why no code path in the whole system ever set `confirmed`.
 *
 * Two things fixed while promoting it:
 *   • `changed_by` is populated. offer_status_history has had the column since
 *     0010 and it has been null on every row ever written, so the table could
 *     answer "what happened" but never "who did it".
 *   • `toStatus` is typed as OfferStatus rather than string — the column is a
 *     pg enum, so a typo used to fail at the database instead of the compiler.
 *
 * Idempotent: a repeat transition to the same status is a no-op, which is what
 * lets callers be safely re-invoked (an agent will double-click «تم التأكيد»).
 */
export async function setOfferStatus(
  supabase: SupabaseClient,
  offerId: string,
  toStatus: OfferStatus,
  note: string | null,
): Promise<void> {
  const { data: current } = await supabase.from("offers").select("status").eq("id", offerId).maybeSingle();
  const fromStatus = (current as { status: string } | null)?.status ?? null;
  if (fromStatus === toStatus) return;

  await supabase.from("offers").update({ status: toStatus }).eq("id", offerId);
  await supabase.from("offer_status_history").insert({
    offer_id: offerId,
    from_status: fromStatus,
    to_status: toStatus,
    note,
    changed_by: await getCurrentEmployeeId(),
  });
}

export type OfferStatusEntry = {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
};

/** The status trail for one offer — feeds the operation timeline. */
export async function listOfferStatusHistory(
  supabase: SupabaseClient,
  offerId: string,
): Promise<OfferStatusEntry[]> {
  const { data } = await supabase
    .from("offer_status_history")
    .select("id, from_status, to_status, note, created_at")
    .eq("offer_id", offerId)
    .order("created_at", { ascending: false });
  return (data ?? []) as OfferStatusEntry[];
}
