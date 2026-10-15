/**
 * «تأكيد الكل» (operations order 5) — the confirmation numbers of several
 * bookings saved in one action: one supplier reference pasted onto all of its
 * bookings, or a quick table (booking · supplier · number · net). Pure: what
 * the server accepts from the table.
 */

export type ConfirmEntry = {
  booking_id: string;
  confirmation_number: string;
  supplier_name?: string;
  net_charged?: number | null;
};

/** A booking still waiting on its supplier's word — what the table offers. A supplier-API booking in flight is not. */
export const awaitingConfirmation = (status: string) => status === "pending" || status === "prebooked" || status === "failed";

/** What is saved: a number typed, a booking of this case still waiting, each once. Untouched fields stay as they are. */
export function entriesToSave(entries: ConfirmEntry[], bookings: { id: string; status: string }[]): ConfirmEntry[] {
  const waiting = new Set(bookings.filter((b) => awaitingConfirmation(b.status)).map((b) => b.id));
  const seen = new Set<string>();
  return entries.flatMap((e) => {
    const confirmation_number = e.confirmation_number.trim();
    if (!confirmation_number || !waiting.has(e.booking_id) || seen.has(e.booking_id)) return [];
    seen.add(e.booking_id);
    const out: ConfirmEntry = { booking_id: e.booking_id, confirmation_number };
    if (e.supplier_name?.trim()) out.supplier_name = e.supplier_name.trim();
    if (e.net_charged != null && Number.isFinite(e.net_charged) && e.net_charged >= 0) out.net_charged = e.net_charged;
    return [out];
  });
}
