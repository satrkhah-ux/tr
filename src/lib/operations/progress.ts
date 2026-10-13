import { CLIENT_STATES, EXECUTION_STATES, type ClientStatus, type ExecutionStatus } from "./state";

/**
 * Where a case actually stands — derived, not clicked (operations order 6).
 * Pure: the bookings, documents, payments and travellers go in; the state the
 * case has REACHED comes out. The caller moves the stored status forward only
 * (state.ts forward()), so a status set by hand ahead of this is never pulled back.
 */

export type ProgressBooking = { kind: string; status: string };
export type ProgressDocument = { kind: string };

const live = (b: ProgressBooking) => b.status !== "cancelled" && b.status !== "failed";
const allConfirmed = (list: ProgressBooking[]) => list.every((b) => b.status === "confirmed");

/**
 * The furthest execution state whose condition — and every earlier one's —
 * holds. A package with no flights passes the flights step (nothing to book);
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
    ["flights_booked", allConfirmed(flights)],
    ["hotels_booked", allConfirmed(hotels)],
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

// ---------- «جاهز للسفر» ----------

export type ReadinessTraveler = {
  name: string;
  passport_expiry: string | null;
  /** visa: null = not tracked; 'not_required' | 'required' | 'submitted' | 'issued'. */
  visa_status?: string | null;
};

export type ReadinessItem = { key: "bookings" | "payment" | "documents" | "passports" | "visas"; ok: boolean; detail: string; anchor: string };

/** six months after the return day, as the airlines ask */
export function passportValidFor(expiry: string | null, travelEnd: string | null): boolean {
  if (!expiry) return false;
  if (!travelEnd) return true;
  const [y, m, d] = travelEnd.split("-").map(Number);
  const limit = new Date(Date.UTC(y, m - 1 + 6, d)).toISOString().slice(0, 10);
  return expiry >= limit;
}

/**
 * The checklist «جاهز للسفر» waits for — every line green. Each line says what
 * is missing in words the agent acts on, and where on the page to fix it.
 */
export function readiness(input: {
  bookings: ProgressBooking[];
  documents: ProgressDocument[];
  paid: number;
  total: number | null;
  travelers: ReadinessTraveler[];
  travelEnd: string | null;
}): ReadinessItem[] {
  const liveBookings = input.bookings.filter(live);
  const open = liveBookings.filter((b) => b.status !== "confirmed").length;
  const docsReached = derivedExecution(input.bookings, input.documents) === "vouchers_issued";
  const owed = input.total != null ? Math.max(0, Math.round((input.total - input.paid) * 100) / 100) : null;
  const expiring = input.travelers.filter((t) => !passportValidFor(t.passport_expiry, input.travelEnd));
  const visaPending = input.travelers.filter((t) => t.visa_status === "required" || t.visa_status === "submitted");
  return [
    { key: "bookings", ok: liveBookings.length > 0 && open === 0, detail: liveBookings.length === 0 ? "لا حجوزات بعد" : open ? `${open} حجز غير مؤكد` : "كل الحجوزات مؤكدة", anchor: "bookings" },
    { key: "payment", ok: owed === 0, detail: owed == null ? "الإجمالي غير معروف" : owed ? `متبقٍ ${owed.toLocaleString("en-US")}` : "مسدّد بالكامل", anchor: "payments" },
    { key: "documents", ok: docsReached, detail: docsReached ? "مستندات العميل صادرة" : "مستندات العميل لم تصدر كلها", anchor: "bookings" },
    {
      key: "passports",
      ok: input.travelers.length > 0 && expiring.length === 0,
      detail: input.travelers.length === 0 ? "لا مسافرين مسجّلين" : expiring.length ? `جواز ${expiring.map((t) => t.name).join("، ")} ناقص أو ينتهي قبل 6 أشهر من العودة` : "الجوازات صالحة",
      anchor: "travelers",
    },
    { key: "visas", ok: visaPending.length === 0, detail: visaPending.length ? `تأشيرة ${visaPending.map((t) => t.name).join("، ")} لم تصدر` : "التأشيرات جاهزة أو غير مطلوبة", anchor: "travelers" },
  ];
}
