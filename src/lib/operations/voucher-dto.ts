/**
 * The voucher payload — what an issued document freezes.
 *
 * A voucher is NOT a redacted view of the offer. It is an operational document
 * the traveller carries to a hotel desk or an airline counter, so it must carry
 * the guest names and the supplier's confirmation number — the two things the
 * sales PDF deliberately never contains.
 *
 * What it must NEVER carry is a passport NUMBER. The type simply has no field
 * for one, which is stronger than remembering not to fill it: if a supplier
 * demands passport numbers, that goes in a supplier dispatch, not in a document
 * the client forwards to their family.
 *
 * Pure module — no crypto, no supabase, no server-only import.
 */

export type VoucherKind = "hotel_voucher" | "flight_ticket" | "itinerary" | "booking_summary";

export type VoucherBooking = {
  kind: string;
  title: string;
  city_name: string;
  start_date: string | null;
  end_date: string | null;
  confirmation_number: string | null;
  supplier_name: string;
  /** free-form label→value pairs: room/board/rooms, or flight no/route/times. */
  detail: Record<string, string>;
  cancellation_policy: string | null;
  /** false = the supplier acknowledged it but it is not ticketed/paid yet. */
  is_paid: boolean;
};

export type VoucherDay = {
  day_number: number;
  date: string | null;
  city_name: string;
  title: string;
  activities: string[];
};

export type VoucherDTO = {
  kind: VoucherKind;
  serial: string;
  issued_at: string;
  destination: string | null;
  customer: { name: string; phone: string | null };
  /** name + nationality only. There is no passport-number field, by design. */
  travelers: { name: string; nationality: string | null }[];
  bookings: VoucherBooking[];
  days: VoucherDay[];
  notes: string[];
};

/** A booking's detail map, ordered so a voucher reads the same way every time. */
export function hotelDetail(input: {
  room_type?: string | null;
  board?: string | null;
  rooms_count?: number | null;
  nights?: number | null;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (input.room_type) out["نوع الغرفة"] = input.room_type;
  if (input.board) out["الإقامة"] = input.board;
  if (input.rooms_count) out["عدد الغرف"] = String(input.rooms_count);
  if (input.nights) out["عدد الليالي"] = String(input.nights);
  return out;
}

export function flightDetail(input: {
  airline?: string | null;
  flight_no?: string | null;
  from_airport?: string | null;
  to_airport?: string | null;
  departure_at?: string | null;
  arrival_at?: string | null;
  cabin?: string | null;
  baggage?: string | null;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (input.airline) out["شركة الطيران"] = input.airline;
  if (input.flight_no) out["رقم الرحلة"] = input.flight_no;
  if (input.from_airport) out["من"] = input.from_airport;
  if (input.to_airport) out["إلى"] = input.to_airport;
  if (input.departure_at) out["الإقلاع"] = input.departure_at.replace("T", " ");
  if (input.arrival_at) out["الوصول"] = input.arrival_at.replace("T", " ");
  if (input.cabin) out["الدرجة"] = input.cabin;
  if (input.baggage) out["الأمتعة"] = input.baggage;
  return out;
}

/** Which bookings belong on a document of this kind. */
export function bookingsForKind(kind: VoucherKind, bookings: VoucherBooking[], bookingId?: string | null): VoucherBooking[] {
  if (bookingId) return bookings.filter((b) => b.title && b.confirmation_number !== undefined);
  if (kind === "hotel_voucher") return bookings.filter((b) => b.kind === "hotel");
  if (kind === "flight_ticket") return bookings.filter((b) => b.kind === "flight");
  if (kind === "booking_summary") return bookings;
  return [];
}

/**
 * A voucher may only be issued against a CONFIRMED booking.
 *
 * Handing a traveller a document for a room nobody has actually booked is worse
 * than handing them nothing: they stop chasing it, and find out at the desk.
 */
export function canIssue(kind: VoucherKind, bookings: VoucherBooking[], days: VoucherDay[]): boolean {
  if (kind === "itinerary") return days.length > 0;
  return bookingsForKind(kind, bookings).length > 0;
}
