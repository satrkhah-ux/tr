import { flightLegs, type Leg } from "./drivers";
import { arabicDay } from "./client-messages";

/**
 * What the client's trip link shows for each service, and when (the owner,
 * 2026-10-17) — pure, so the page, the client's messages, the voucher gate and
 * the morning alert all read the same rules:
 *
 *  · every service carries a booking number of OURS from the day the client
 *    confirms (operation_bookings.company_ref, 0084);
 *  · a flight says «سيتم تأكيد الحجز» until its ticket is in, then its PNR,
 *    its flight numbers and its times;
 *  · a hotel shows its name, its dates and our number — never called
 *    provisional — until the hotel's OWN confirmation arrives; then that
 *    number, the rooms and the voucher. The voucher shown at the desk never
 *    exists before it (issueDocument) and stops being handed out when the
 *    confirmation it prints is taken back (voucherLive).
 *
 * Nothing here is sent: an update is PREPARED for staff, who press «إرسال».
 */

type FlightLegRow = { flight_no: string; from: string; to: string; departs_at: string | null; arrives_at: string | null };

export type ClientBookingRow = {
  id?: string;
  kind: string;
  title: string;
  city_name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  confirmation_number: string | null;
  /** ours (0084) — absent only on rows read before it. */
  company_ref?: string | null;
  pnr?: string | null;
  ticket_numbers?: string[] | null;
  flight_legs?: FlightLegRow[] | null;
  is_paid?: boolean | null;
  detail: Record<string, string> | null;
};

const text = (s: string | null | undefined) => s?.trim() || null;

/** The hotel's own confirmation is in: confirmed, with a number that is the hotel's and not ours. */
export function hotelFinal(b: Pick<ClientBookingRow, "status" | "confirmation_number" | "company_ref">): boolean {
  const n = text(b.confirmation_number);
  return b.status === "confirmed" && n !== null && n !== b.company_ref;
}

/**
 * THE flight-done rule (the owner, 2026-10-18) — the wizard's step, the ticket
 * document, the client's link, the execution ladder and the readiness gate all
 * ask this one: confirmed, AND ticketed — the uploaded ticket's PNR or ticket
 * numbers, or a hand confirmation marked «صدرت التذكرة» (is_paid) with its
 * reference. A seat the airline only HOLDS has a confirmation number too, and
 * is not a ticket: counting it would issue the ticket document and prepare a
 * «ticket issued» message for a client who has no ticket. Before, three rules
 * disagreed; now one, and «تسجيل يدوي» with «صدرت التذكرة» counts everywhere.
 */
export function flightTicketed(b: Pick<ClientBookingRow, "status" | "confirmation_number" | "pnr" | "ticket_numbers" | "is_paid">): boolean {
  if (b.status !== "confirmed") return false;
  return text(b.pnr) !== null || (b.ticket_numbers?.length ?? 0) > 0 || (b.is_paid === true && text(b.confirmation_number) !== null);
}

const flightPnr = (b: ClientBookingRow) => text(b.pnr) ?? (b.status === "confirmed" ? text(b.confirmation_number) : null);

export type TripFlight = { title: string; ref: string | null; ticketed: boolean; pnr: string | null; cabin: string; legs: (Leg & { label: string })[] };

export function clientFlight(b: ClientBookingRow): TripFlight {
  const ticketed = flightTicketed(b);
  const typed = (b.flight_legs ?? []).map((l) => ({ flight_no: l.flight_no, from: l.from, to: l.to, departure: l.departs_at, arrival: l.arrives_at, label: "" }));
  return {
    title: b.title,
    ref: b.company_ref ?? null,
    ticketed,
    pnr: ticketed ? flightPnr(b) : null,
    cabin: b.detail?.["الدرجة"] ?? "",
    // no flight number and no time before the ticket — the plan may still move
    legs: !ticketed
      ? []
      : typed.length > 0
        ? typed
        : flightLegs(b.detail ?? {}).map(({ key, leg }) => ({ ...leg, label: key === "رقم الرحلة" ? "" : key })),
  };
}

export type TripHotel = {
  name: string;
  city: string;
  check_in: string | null;
  check_out: string | null;
  nights: string;
  /** ours — shown from the start, as the booking number. */
  ref: string | null;
  /** the hotel's own number, once it is in; null before. */
  confirmation: string | null;
  rooms: string[];
};

/** The rooms of a stay, as the voucher words them — and nothing else from its detail. */
const ROOM_KEY = /^(الغرفة|نوع الغرفة|الإقامة|عدد الغرف)/;

export function clientHotel(b: ClientBookingRow): TripHotel {
  const d = b.detail ?? {};
  const final = hotelFinal(b);
  return {
    name: b.title,
    city: b.city_name || d["المدينة"] || "",
    check_in: b.start_date,
    check_out: b.end_date,
    nights: d["عدد الليالي"] ?? "",
    ref: b.company_ref ?? null,
    confirmation: final ? text(b.confirmation_number) : null,
    // before the hotel confirms: its name, its dates and our number — nothing else
    rooms: final ? Object.entries(d).filter(([k]) => ROOM_KEY.test(k)).map(([k, v]) => `${k}: ${v}`) : [],
  };
}

/** A stay as an issued voucher froze it, or a hotel booking as it is now. */
export type StayKey = { confirmation_number?: string | null; start_date?: string | null };
const stayKey = (s: StayKey) => `${text(s.confirmation_number) ?? ""}|${s.start_date ?? ""}`;

/**
 * May this issued hotel voucher still be handed out? Only while every stay it
 * prints is one of the case's hotels whose own confirmation is in — the same
 * number, the same check-in. A number taken back or dates moved since, and the
 * paper is stale: the desk would be shown what the hotel no longer holds.
 */
export function voucherLive(
  stays: readonly StayKey[] | null | undefined,
  hotels: readonly Pick<ClientBookingRow, "kind" | "status" | "confirmation_number" | "company_ref" | "start_date">[],
): boolean {
  const live = new Set(hotels.filter((h) => h.kind === "hotel" && hotelFinal(h)).map(stayKey));
  return (stays?.length ?? 0) > 0 && stays!.every((s) => live.has(stayKey(s)));
}

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Red (the owner): a hotel still holding only our number from the day before travel until it is checked out of. */
export function hotelAtRisk(b: ClientBookingRow, travelStart: string | null, today: string): boolean {
  if (b.kind !== "hotel" || b.status === "cancelled" || hotelFinal(b)) return false;
  const from = travelStart ?? b.start_date;
  return from !== null && addDays(today, 1) >= from && (!b.end_date || today < b.end_date);
}

// ---------- the updates prepared for staff ----------

/** `template`: the approved WhatsApp template it travels as after the client's 24 hours (WA_TEMPLATES). */
export type PreparedMessage = { key: string; label: string; body: string; template: "bookings_confirmed" | "booking_update" };

const SIGN = "فريق ترافليون للسفر والسياحة";

const clock = (iso: string | null) => (iso && /T\d{2}:\d{2}/.test(iso) ? iso.slice(11, 16) : "");

/**
 * What is ready to send, in the order it happens: the trip link with our
 * numbers once the client confirmed, a flight's ticket once it is in, a
 * hotel's confirmation once it is in AND its voucher is issued. Each once —
 * `sent` holds the keys already dispatched; a re-ticket or a new hotel number
 * is a new key, so it is prepared again.
 */
export function preparedMessages(input: {
  hello: string;
  destination: string | null;
  serial: string;
  /** the trip page; null when its link was stopped — nothing to point at. */
  link: string | null;
  bookings: ClientBookingRow[];
  /** the stays on the case's live hotel vouchers. */
  voucherStays: readonly StayKey[];
  sent: ReadonlySet<string>;
}): PreparedMessage[] {
  if (!input.link) return [];
  const where = input.destination?.trim() ? ` إلى ${input.destination.trim()}` : "";
  const live = input.bookings
    .filter((b) => b.status !== "cancelled")
    .sort((a, b) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"));
  const out: PreparedMessage[] = [];

  const numbered = live.filter((b) => b.company_ref);
  if (!input.sent.has("trip_link") && numbered.length > 0) {
    out.push({
      key: "trip_link",
      label: "رابط الرحلة وأرقام الحجوزات",
      template: "bookings_confirmed",
      body: [
        input.hello,
        `تم تأكيد حجز رحلتك${where}`,
        `(رقم الملف ${input.serial})`,
        ["أرقام حجوزاتك لدينا:", ...numbered.map((b) => `• ${b.title}: ${b.company_ref}`)].join("\n"),
        "تفاصيل رحلتك ومستنداتك من هنا، وتتحدّث أولاً بأول:",
        input.link,
        SIGN,
      ].join("\n\n"),
    });
  }

  for (const b of live.filter((x) => x.kind === "flight" && x.id && flightTicketed(x))) {
    const f = clientFlight(b);
    const key = `flight:${b.id}:${f.pnr ?? "ticket"}`;
    if (input.sent.has(key)) continue;
    const legs = f.legs.map((l) => {
      const when = l.departure ? ` — ${arabicDay(l.departure)} ${clock(l.departure)}`.trimEnd() : "";
      return `• ${[l.flight_no, `${l.from} → ${l.to}`].filter(Boolean).join(" ")}${when}`;
    });
    out.push({
      key,
      label: `تأكيد تذكرة الطيران — ${b.title}`,
      template: "booking_update",
      body: [
        input.hello,
        `تم إصدار تذكرة الطيران لرحلتك${where}`,
        ...(f.pnr ? [`رقم الحجز (PNR): ${f.pnr}`] : []),
        ...(legs.length ? [legs.join("\n")] : []),
        "التفاصيل كاملة في رابط رحلتك:",
        input.link,
        SIGN,
      ].join("\n\n"),
    });
  }

  const vouchered = new Set(input.voucherStays.map(stayKey));
  for (const b of live.filter((x) => x.kind === "hotel" && x.id && hotelFinal(x) && vouchered.has(stayKey(x)))) {
    const h = clientHotel(b);
    const key = `hotel:${b.id}:${h.confirmation}`;
    if (input.sent.has(key)) continue;
    out.push({
      key,
      label: `تأكيد فندق ${h.city || h.name} والفاوتشر`,
      template: "booking_update",
      body: [
        input.hello,
        `تم تأكيد فندقك${h.city ? ` في ${h.city}` : ""}: ${h.name}`,
        ...(h.check_in ? [`من ${arabicDay(h.check_in)}${h.check_out ? ` إلى ${arabicDay(h.check_out)}` : ""}`] : []),
        `رقم تأكيد الفندق: ${h.confirmation}`,
        "قسيمة الفندق (الفاوتشر) جاهزة في رابط رحلتك — قدّمها عند الوصول إلى الفندق:",
        input.link,
        SIGN,
      ].join("\n\n"),
    });
  }
  return out;
}
