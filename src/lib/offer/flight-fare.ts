import type { DraftTrip, FlightBooking, FlightFare } from "./draft-types";

/**
 * «إجمالي / للفرد» — a flight booking priced per ticket.
 *
 * The booking total stays THE price (`intl_price` / `dom_price`): the pricing
 * line, a partner's sheet and the issued offer all read it. «للفرد» only says
 * how it is worked out — adult × adults + child × children + infant × infants —
 * and it is worked out again whenever the travellers change.
 *
 * Pure: the generator, Basic and the server's re-pricing all call these.
 */

export type FlightKind = "intl" | "dom";
type Pax = Pick<DraftTrip, "adults" | "children" | "infants">;

const fareOf = (b: FlightBooking, kind: FlightKind): FlightFare => (kind === "intl" ? b.intl_fare : b.dom_fare);
const priceOf = (b: FlightBooking, kind: FlightKind): number | null => (kind === "intl" ? b.intl_price : b.dom_price);
const put = (b: FlightBooking, kind: FlightKind, fare: FlightFare, price: number | null): FlightBooking =>
  kind === "intl" ? { ...b, intl_fare: fare, intl_price: price } : { ...b, dom_fare: fare, dom_price: price };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The booking's total: the typed figure, or the tickets added up. No adult fare yet → unpriced. */
export function flightBookingTotal(booking: FlightBooking, trip: Pax, kind: FlightKind): number | null {
  const fare = fareOf(booking, kind);
  if (fare.price_mode !== "per_person") return priceOf(booking, kind);
  if (fare.adult_price == null) return null;
  // a child's ticket is the adult's unless typed; an infant's is nothing unless typed
  const child = fare.child_price ?? fare.adult_price;
  return round2(fare.adult_price * trip.adults + child * trip.children + (fare.infant_price ?? 0) * trip.infants);
}

/** Both bookings with their «للفرد» totals worked out for these travellers (the same object when nothing moved). */
export function withFlightTotals(booking: FlightBooking, trip: Pax): FlightBooking {
  let out = booking;
  for (const kind of ["intl", "dom"] as const) {
    const fare = fareOf(out, kind);
    if (fare.price_mode !== "per_person") continue;
    const total = flightBookingTotal(out, trip, kind);
    if (total !== priceOf(out, kind)) out = put(out, kind, fare, total);
  }
  return out;
}

/**
 * A change on the «إجمالي / للفرد» fields. Leaving «للفرد» keeps the figure it
 * came to; entering it (or changing a ticket) works the total out.
 */
export function withFare(booking: FlightBooking, trip: Pax, kind: FlightKind, change: Partial<FlightFare>): FlightBooking {
  const fare = { ...fareOf(booking, kind), ...change };
  const total = flightBookingTotal(fare.price_mode === "per_person" ? put(booking, kind, fare, null) : booking, trip, kind);
  return put(booking, kind, fare, total);
}

/** A total typed as such (the card's total box, the pricing sheet): the booking is «إجمالي» at that figure. */
export function withTypedTotal(booking: FlightBooking, kind: FlightKind, price: number | null): FlightBooking {
  return put(booking, kind, { ...fareOf(booking, kind), price_mode: "total" }, price);
}

/** «3 بالغ × 1,500 + طفل × 1,200» — the tickets behind a «للفرد» total; null for a typed total. */
export function fareBreakdown(booking: FlightBooking, trip: Pax, kind: FlightKind): string | null {
  const fare = fareOf(booking, kind);
  if (fare.price_mode !== "per_person" || fare.adult_price == null) return null;
  const part = (count: number, label: string, price: number | null) =>
    count > 0 && price != null ? `${count > 1 ? `${count} ` : ""}${label} × ${price.toLocaleString("en-US")}` : null;
  return [
    part(trip.adults, "بالغ", fare.adult_price),
    part(trip.children, "طفل", fare.child_price ?? fare.adult_price),
    part(trip.infants, "رضيع", fare.infant_price),
  ]
    .filter(Boolean)
    .join(" + ");
}
