import { normAr } from "@/lib/catalog/norm";
import type { MailRefs } from "./classify";

/**
 * Which booking an email is about — pure, over candidates the reader loads.
 *
 * A number match is proof; a name match is only a hint, so it must also agree
 * on the dates before it links anything. No match links nothing: a wrong link
 * sends a cancellation notice to the wrong client's file.
 */

export type MatchCandidate = {
  booking_id: string;
  operation_id: string;
  confirmation_number: string | null;
  supplier_ref: string | null;
  client_reference: string | null;
  hotel_title: string | null;
  guest_names: string[];
  check_in: string | null;
  check_out: string | null;
};

export type MailMatch = { booking_id: string; operation_id: string; matched_by: "number" | "name_dates" };

const foldNumber = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, "").toUpperCase();

export function matchEmail(refs: MailRefs, candidates: MatchCandidate[]): MailMatch | null {
  const numbers = new Set([...refs.numbers, ...refs.serials].map(foldNumber).filter(Boolean));
  for (const c of candidates) {
    if ([c.confirmation_number, c.supplier_ref, c.client_reference].some((v) => foldNumber(v) && numbers.has(foldNumber(v)))) {
      return { booking_id: c.booking_id, operation_id: c.operation_id, matched_by: "number" };
    }
  }
  const names = new Set([...refs.hotels, ...refs.guests].map(normAr).filter(Boolean));
  if (!names.size || !refs.dates.length) return null;
  for (const c of candidates) {
    const nameHit = (normAr(c.hotel_title) && names.has(normAr(c.hotel_title))) || c.guest_names.some((g) => normAr(g) && names.has(normAr(g)));
    if (!nameHit || !c.check_in || !c.check_out) continue;
    // a mentioned date inside the stay confirms the hint
    if (refs.dates.some((d) => d >= c.check_in! && d <= c.check_out!)) {
      return { booking_id: c.booking_id, operation_id: c.operation_id, matched_by: "name_dates" };
    }
  }
  return null;
}
