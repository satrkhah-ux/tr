/**
 * «الفنادق» — step 3 of «معالج الحجوزات».
 *
 * A hotel booking is FINAL when it is confirmed AND holds the confirmation
 * number — the hotel's own, read off its confirmation (or the supplier API's).
 * Until then the client sees our company_ref (0084); the client page reads
 * exactly this rule, so it lives in one place.
 *
 * The confirmation is read for its number, stay, room, guests and the hotel's
 * own address and phone, and compared with the booking: what differs is shown
 * in yellow for the employee to look at, never corrected silently.
 *
 * Pure: no React, no Supabase.
 */
import type { OperationBooking } from "@/lib/data/operation-bookings";
import { hotelFinal } from "@/lib/operations/client-booking-state";
import { datesOn, normalizeTicketText, passengersIn } from "@/lib/flights/ticket-parse";
import { nameTokens, type NameCheck } from "./flights";
import { notPulled } from "./pull";
import type { ReadinessItem, StepState, WizardCase } from "./types";

// ---------------- the step's state ----------------

export function hotelBookings(data: Pick<WizardCase, "bookings">): OperationBooking[] {
  return data.bookings.filter((b) => b.kind === "hotel" && b.status !== "cancelled");
}

/** The hotel's OWN number is in — our company_ref alone is not final (the same rule as the voucher, client-booking-state.ts). */
export function isFinal(b: Pick<OperationBooking, "status" | "confirmation_number" | "company_ref">): boolean {
  return hotelFinal(b);
}

export function hotelsState(data: Pick<WizardCase, "bookings" | "offerKinds">): StepState {
  const hotels = hotelBookings(data);
  if (hotels.length === 0) return notPulled(data, "hotel") ? "todo" : "na";
  return hotels.every(isFinal) ? "done" : "todo";
}

/** «التأكيد النهائي»: every hotel final — mandatory before «جاهز للسفر». */
export function hotelsReadiness(data: Pick<WizardCase, "bookings">): ReadinessItem[] {
  const hotels = hotelBookings(data);
  if (hotels.length === 0) return notPulled(data, "hotel") ? [{ step: "hotels", key: "pulled", ok: false }] : [];
  return [{ step: "hotels", key: "final", ok: hotels.every(isFinal) }];
}

// ---------------- reading a confirmation ----------------

export type HotelConfirmation = {
  confirmation: string;
  check_in: string;
  check_out: string;
  room: string;
  guests: string[];
  /** the hotel's own, when the paper prints them — filled into /hotels only where empty there. */
  address: string;
  phone: string;
};

/** The hotel's own number first: a supplier's voucher prints its booking reference beside it. */
const NUMBER_LABELS = [
  /HOTEL\s+CONF(?:IRMATION)?\.?\s*(?:NO\.?|NUMBER|#|CODE|REF(?:ERENCE)?)?|رقم\s*تأكيد\s*الفندق|رقم\s*الحجز\s*(?:لدى|في)\s*الفندق/iu,
  /CONF(?:IRMATION)?\.?\s*(?:NO\.?|NUMBER|#|CODE|REF(?:ERENCE)?)|رقم\s*التأكيد/iu,
  /(?:RESERVATION|BOOKING)\s*(?:NO\.?|NUMBER|#|CODE|ID|REF(?:ERENCE)?)|رقم\s*الحجز|مرجع\s*الحجز/iu,
];
const CHECK_IN = /CHECK[\s-]?IN|ARRIVAL|تاريخ\s*الوصول|تسجيل\s*الدخول|الوصول|الدخول/iu;
const CHECK_OUT = /CHECK[\s-]?OUT|DEPARTURE|تاريخ\s*المغادرة|تسجيل\s*الخروج|المغادرة|الخروج/iu;
const STAY = /STAY|DATES|PERIOD|الإقامة|الاقامة|الفترة/iu;
const ROOM = /(?<![\p{L}])(?:ROOM\s*(?:TYPE|CATEGORY|NAME|DESCRIPTION)|ROOM|نوع\s*الغرفة|فئة\s*الغرفة|الغرفة)\s*[:：]\s*(.+)$/iu;
const GUESTS = /(?<![\p{L}])(?:GUEST\s*NAMES?|LEAD\s*GUEST|GUESTS?|اسم\s*النزيل|أسماء\s*النزلاء|اسماء\s*النزلاء|النزلاء|النزيل|اسم\s*الضيف|الضيوف)\s*[:：]\s*(.+)$/iu;
const ADDRESS = /(?<!E-?MAIL\s*)(?:HOTEL\s+)?ADDRESS\s*[:：]\s*(.*)$|(?:عنوان\s*الفندق|العنوان)\s*[:：]\s*(.*)$/iu;
/** «Hotel Phone» before a bare «Tel»: a confirmation also prints the agency's and the guest's numbers. */
const HOTEL_PHONE = /(?:HOTEL\s*(?:PHONE|TEL(?:EPHONE)?|CONTACT(?:\s*NO\.?)?)|هاتف\s*الفندق|رقم\s*الفندق)\s*[:：.]?\s*(\+?[\d\s()-]{7,22})/iu;
const PHONE = /(?<![\p{L}])(?:PHONE|TEL(?:EPHONE)?|هاتف|الهاتف)\s*[:：.]\s*(\+?[\d\s()-]{7,22})/iu;
/** …and never a line about someone else's number. */
const NOT_HOTEL_PHONE = /MOBILE|GUEST|AGEN(?:T|CY)|CUSTOMER|EMERGENCY|جوال|العميل|الوكيل|الوكالة|الضيف|النزيل/iu;

const isDate = (t: string) => /^\d{4}-\d{2}-\d{2}$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(t);

/** The first reference-shaped word with a digit in it — not a date. */
function refIn(s: string): string {
  for (const m of s.toUpperCase().matchAll(/(?<![A-Z0-9])([A-Z0-9][A-Z0-9/-]{2,24})(?![A-Z0-9])/g)) {
    if (/\d/.test(m[1]) && !isDate(m[1])) return m[1];
  }
  return "";
}

function numberIn(lines: string[]): string {
  for (const re of NUMBER_LABELS) {
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(re);
      if (!m || m.index === undefined) continue;
      const below = lines[i + 1]?.trim() ?? "";
      const v = refIn(lines[i].slice(m.index + m[0].length)) || (below.length <= 30 ? refIn(below) : "");
      if (v) return v;
    }
  }
  return "";
}

/**
 * The date a label introduces: on its line after it, or on the line below when
 * the label heads a column — «Check-in   Check-out» over «15 Nov   20 Nov» is
 * read by the labels' order.
 */
function dateAfter(lines: string[], re: RegExp, other: RegExp, now: Date): string {
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(re);
    if (!m || m.index === undefined) continue;
    const rest = lines[i].slice(m.index + m[0].length).split(other)[0];
    const own = datesOn(rest, now);
    if (own[0]) return own[0];
    // only a heading of labels reads on below — «Arrival time: 14:00» does not, nor into another label's line
    const next = lines[i + 1] ?? "";
    if (/\d/.test(lines[i]) || re.test(next) || other.test(next)) continue;
    const below = datesOn(next, now);
    const second = other.test(lines[i].slice(0, m.index));
    if (below.length > (second ? 1 : 0)) return below[second ? 1 : 0];
  }
  return "";
}

const TITLE = /^(?:MRS|MR|MS|MISS|MSTR|DR|السيدة|السيد)\.?\s+/iu;

export function parseHotelConfirmation(input: string, now: Date = new Date()): HotelConfirmation {
  const lines = normalizeTicketText(input).split("\n");
  let check_in = dateAfter(lines, CHECK_IN, CHECK_OUT, now);
  let check_out = dateAfter(lines, CHECK_OUT, CHECK_IN, now);
  if (!check_in || !check_out) {
    const stay = lines.map((l) => (STAY.test(l) ? datesOn(l, now) : [])).find((d) => d.length >= 2);
    if (stay) [check_in, check_out] = [check_in || stay[0], check_out || stay[1]];
  }

  const room = lines
    .map((l) => l.match(ROOM)?.[1]?.split(/\s{2,}|\|/)[0].trim() ?? "")
    .find((v) => /\p{L}{3}/u.test(v) && !/^\d+\s*(?:rooms?|غرف[ةه]?)?$/iu.test(v));

  const guests: string[] = [];
  // one guest however the paper wrote them: «TESTUSER/FAHAD MR» on one line, «Fahad Testuser» on another
  const same = (a: string, b: string) => nameTokens(a).sort().join(" ") === nameTokens(b).sort().join(" ");
  const add = (raw: string) => {
    for (const part of raw.split(/\s*[,،;&]\s*|\s+and\s+|\s+و\s+/iu)) {
      const name = part.replace(TITLE, "").replace(/\s+(?:MRS|MR|MS|MISS)\.?$/i, "").trim();
      if (/\p{L}{2}/u.test(name) && !/\d/.test(name) && name.length <= 60 && !guests.some((g) => same(g, name))) guests.push(name);
    }
  };
  for (const l of lines) {
    const m = l.match(GUESTS);
    if (m) add(m[1].split(/\s{2,}|\|/)[0]);
  }
  passengersIn(input).forEach(add);

  const address = lines
    .map((l, i) => {
      const m = l.match(ADDRESS);
      if (!m) return "";
      const v = (m[1] ?? m[2] ?? "").trim() || (lines[i + 1] ?? "").trim();
      return v.split(/\s{2,}|\|/)[0].trim();
    })
    .find((v) => /\p{L}{3}/u.test(v) && v.length <= 200);

  const phoneOf = (re: RegExp) =>
    lines.map((l) => (re === PHONE && NOT_HOTEL_PHONE.test(l) ? "" : (l.match(re)?.[1]?.trim() ?? ""))).find((v) => (v.match(/\d/g)?.length ?? 0) >= 7) ?? "";

  return {
    confirmation: numberIn(lines),
    check_in,
    check_out,
    room: room ?? "",
    guests: guests.slice(0, 12),
    address: address ?? "",
    phone: (phoneOf(HOTEL_PHONE) || phoneOf(PHONE)).replace(/\s+/g, " "),
  };
}

// ---------------- against the booking ----------------

export type HotelDiff = { key: "checkIn" | "checkOut" | "room" | "guest"; ours: string; theirs: string };

/** The booking's room lines («الغرفة», «الغرفة 2») as the plan wrote them. */
export function roomLines(detail: Record<string, string> | null): string[] {
  return Object.entries(detail ?? {})
    .filter(([k]) => /^الغرفة(?: \d+)?$/.test(k))
    .map(([, v]) => v);
}

const loose = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * What the confirmation says that the booking does not: other dates, another
 * room (an English room name against our Arabic one always shows — both are
 * printed for the eye), a guest who is none of the travellers.
 */
export function hotelDiffs(read: HotelConfirmation, b: { start_date: string | null; end_date: string | null; detail: Record<string, string> | null }, names: NameCheck[]): HotelDiff[] {
  const out: HotelDiff[] = [];
  if (read.check_in && read.check_in !== b.start_date) out.push({ key: "checkIn", ours: b.start_date ?? "", theirs: read.check_in });
  if (read.check_out && read.check_out !== b.end_date) out.push({ key: "checkOut", ours: b.end_date ?? "", theirs: read.check_out });
  const rooms = roomLines(b.detail);
  const r = loose(read.room);
  if (r && !rooms.some((x) => loose(x).includes(r) || (loose(x) && r.includes(loose(x))))) out.push({ key: "room", ours: rooms.join(" / "), theirs: read.room });
  for (const n of names) if (n.status === "mismatch") out.push({ key: "guest", ours: "", theirs: n.name });
  return out;
}
