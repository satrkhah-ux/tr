import { CLIENT_DOCUMENT_KINDS, type VoucherKind } from "./voucher-dto";

/**
 * «حقيبة السفر» (operations order 11, suggestion 9) — which issued documents go
 * into the client's one PDF, and in what order. Pure.
 *
 * The order is the order of the trip: the ticket at the airport, the voucher at
 * the hotel desk, then the programme. Only client kinds are ever picked — the
 * booking summary and the welcome board are ours.
 */

const RANK: Partial<Record<VoucherKind, number>> = { flight_ticket: 0, hotel_voucher: 1, itinerary: 2 };
const rank = (k: VoucherKind) => RANK[k] ?? 9;

export type PackDocRow = { kind: VoucherKind; booking_id: string | null; created_at: string };

/**
 * Per kind: the latest document for the whole kind, plus — for a hotel issued
 * on its own (booking_id) — the latest one per booking issued AFTER it. A
 * single-hotel voucher older than the latest whole voucher is already inside it.
 */
export function pickPackDocuments<T extends PackDocRow>(rows: T[]): T[] {
  const kinds = [...CLIENT_DOCUMENT_KINDS].sort((a, b) => rank(a) - rank(b));
  const newer = (a: T, b: T | undefined) => !b || a.created_at > b.created_at;
  const out: T[] = [];
  for (const kind of kinds) {
    let whole: T | undefined;
    for (const r of rows) if (r.kind === kind && !r.booking_id && newer(r, whole)) whole = r;
    const perBooking = new Map<string, T>();
    for (const r of rows) {
      if (r.kind !== kind || !r.booking_id || (whole && r.created_at <= whole.created_at)) continue;
      if (newer(r, perBooking.get(r.booking_id))) perBooking.set(r.booking_id, r);
    }
    out.push(...[...(whole ? [whole] : []), ...perBooking.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)));
  }
  return out;
}
