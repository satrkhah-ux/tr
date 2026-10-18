import { translate } from "@/lib/i18n";
import { flightTicketed, hotelFinal } from "./client-booking-state";
import { CLIENT_STATES, EXECUTION_STATES, type ClientStatus, type ExecutionStatus } from "./state";
import type { TravelerListItem } from "./traveler-dto";
import { ageOn, passportIssues } from "./travelers";

/**
 * Where a case actually stands — derived, not clicked (operations order 6).
 * Pure: the bookings, documents, payments and travellers go in; the state the
 * case has REACHED comes out. The caller moves the stored status forward only
 * (state.ts forward()), so a status set by hand ahead of this is never pulled back.
 */

/** The columns the flight and hotel rungs read — the wizard's own done-rules (client-booking-state). */
export type ProgressBooking = {
  kind: string;
  status: string;
  confirmation_number: string | null;
  company_ref?: string | null;
  pnr?: string | null;
  ticket_numbers?: string[] | null;
};
export type ProgressDocument = { kind: string };

const live = (b: ProgressBooking) => b.status !== "cancelled" && b.status !== "failed";
const allConfirmed = (list: ProgressBooking[]) => list.every((b) => b.status === "confirmed");

/**
 * The furthest execution state whose condition — and every earlier one's —
 * holds. The flight and hotel rungs ask the wizard's own done-rules
 * (flightTicketed, hotelFinal): a hotel holding only OUR number is not
 * «hotels_booked» while its tile is red, and the client is not told «bookings
 * confirmed» (MESSAGE_ON_STATE) on it. A package with no flights passes the
 * flights step (nothing to book);
 * documents count once every client document its bookings need is out.
 * Never «ready_to_travel» or «travelled»: those wait for the checklist and the
 * calendar. Null when nothing is live yet (an empty case is not «booked»).
 */
export function derivedExecution(bookings: ProgressBooking[], documents: ProgressDocument[]): ExecutionStatus | null {
  const liveBookings = bookings.filter(live);
  if (liveBookings.length === 0) return null;
  const of = (...kinds: string[]) => liveBookings.filter((b) => kinds.includes(b.kind));
  const flights = of("flight");
  const hotels = of("hotel");
  const ground = of("transport", "service");
  const has = (kind: string) => documents.some((d) => d.kind === kind);

  const steps: [ExecutionStatus, boolean][] = [
    ["flights_booked", flights.every(flightTicketed)],
    ["hotels_booked", hotels.every(hotelFinal)],
    ["transfers_booked", allConfirmed(ground) && allConfirmed(of("visa"))],
    ["vouchers_issued", (hotels.length === 0 || has("hotel_voucher")) && (flights.length === 0 || has("flight_ticket")) && has("itinerary")],
  ];
  let reached: ExecutionStatus | null = null;
  for (const [state, ok] of steps) {
    if (!ok) break;
    reached = state;
  }
  return reached;
}

/** The client track from the money: anything paid is «partly», the total paid is «in full». */
export function derivedClient(paid: number, total: number | null): ClientStatus | null {
  if (total != null && total > 0 && paid >= total - 0.005) return "paid_full";
  if (paid > 0) return "paid_partial";
  return null;
}

/** Whether `to` is further along than `from` — the only moves the sync makes. */
export function isAhead(order: readonly string[], from: string, to: string | null): to is string {
  if (!to || from === "cancelled") return false;
  return order.indexOf(to) > order.indexOf(from);
}
export const aheadOfExecution = (from: ExecutionStatus, to: ExecutionStatus | null) => isAhead(EXECUTION_STATES, from, to);
export const aheadOfClient = (from: ClientStatus, to: ClientStatus | null) => isAhead(CLIENT_STATES, from, to);

// ---------- the daily passport alerts ----------

export type AlertTraveler = Pick<TravelerListItem, "id" | "display_name" | "has_passport" | "passport_expiry" | "birth_date" | "age" | "traveler_kind">;

/**
 * The daily Telegram passport alerts (daily.ts): passportIssues — the same
 * decision as the traveler row, «جاهز للسفر» and /trip — one alert per traveler
 * and issue. `ref` is the operation_alerts key that sends it once; the expiry
 * pair keeps the bare traveler id the expiry-only check used, so an alert
 * already sent is not sent again.
 */
export function passportAlerts(travelers: AlertTraveler[], trip: { travel_start: string | null; travel_end: string | null }, today: string): { ref: string; text: string }[] {
  return travelers.flatMap((t) =>
    passportIssues(t, trip, today).map((issue) => {
      const expiry = issue === "passport_expired" || issue === "passport_short";
      const gap = translate("ar", `ops.trav.gap.${issue}`, { n: ageOn(t.birth_date, trip.travel_start ?? today) ?? "" });
      return { ref: expiry ? t.id : `${t.id}:${issue}`, text: `🛂 ${t.display_name || "مسافر"}: ${gap}${expiry ? ` (${t.passport_expiry})` : ""}` };
    }),
  );
}

