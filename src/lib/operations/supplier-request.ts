/**
 * The supplier side of a booking: who sells it, the request we send them, how
 * long they have been silent, and what we owe them.
 *
 * The request is written in the supplier's own language from what the operation
 * already holds — the names as in the passport, the rooms, the flight times, the
 * meeting point — so a DMC in Kuala Lumpur gets the booking the client agreed
 * to, in English, rather than a paraphrase typed at speed. It is returned for
 * review; nothing here sends.
 *
 * Pure: no React, no Supabase.
 */

export type RequestLang = "ar" | "en";
export type SupplierBookingKind = "hotel" | "flight" | "visa" | "transport" | "service";

/** The word a company_suppliers row lists for each kind («فنادق، طيران، تنقلات، خدمات»). */
const CATEGORY: Record<SupplierBookingKind, string> = {
  hotel: "فنادق",
  flight: "طيران",
  transport: "تنقلات",
  service: "خدمات",
  visa: "خدمات",
};

/**
 * The suppliers worth offering for a booking: those that sell its kind, or that
 * never said what they sell. When none match, everyone — like the generator's
 * picker, a list nobody categorised must not leave the agent with nobody.
 */
export function suppliersFor<T extends { categories?: string | null }>(list: T[], kind: SupplierBookingKind): T[] {
  const matching = list.filter((s) => !(s.categories ?? "").trim() || (s.categories ?? "").includes(CATEGORY[kind]));
  return matching.length > 0 ? matching : list;
}

// ---------- the request ----------

export type RequestTraveler = { name: string; kind: "adult" | "child" | "infant" };

export type SupplierRequestInput = {
  lang: RequestLang;
  /** our file number — the offer serial — so their answer can be matched. */
  reference: string;
  /** the person it is addressed to. */
  contact: string | null;
  booking: {
    kind: SupplierBookingKind;
    title: string;
    city_name: string;
    start_date: string | null;
    end_date: string | null;
    detail: Record<string, string>;
  };
  /** in passport order, the lead first; names as in the passport where we have them. */
  travelers: RequestTraveler[];
  /** what the agent asked for in their own words — never translated. */
  note: string | null;
  /** Arabic name → English (cities, the hotel), from the catalogue. Used for English only. */
  glossary?: Record<string, string>;
};

const TEXT = {
  ar: {
    title: "طلب حجز",
    company: "ترافليون للسفر والسياحة",
    greet: (to: string | null) => (to ? `السلام عليكم ${to}،` : "السلام عليكم،"),
    intro: "نرجو حجز ما يلي، وتأكيده برقم الحجز وسياسة الإلغاء.",
    reference: "مرجعنا",
    service: "المطلوب",
    city: "المدينة",
    date: "التاريخ",
    checkIn: "الدخول",
    checkOut: "الخروج",
    dates: "التواريخ",
    guests: "المسافرون (الأسماء كما في الجواز)",
    namesLater: "الأسماء تُرسل لاحقاً",
    note: "ملاحظة",
    thanks: "شكراً لكم،",
    sign: "قسم العمليات — ترافليون",
    kind: { adult: "بالغ", child: "طفل", infant: "رضيع" },
  },
  en: {
    title: "Booking request",
    company: "Traveliun Travel & Tourism",
    greet: (to: string | null) => (to ? `Dear ${to},` : "Dear team,"),
    intro: "Please book the following and confirm with your booking reference and cancellation policy.",
    reference: "Our reference",
    service: "Service",
    city: "City",
    date: "Date",
    checkIn: "Check-in",
    checkOut: "Check-out",
    dates: "Dates",
    guests: "Travellers (names as in passport)",
    namesLater: "Names to follow",
    note: "Note",
    thanks: "Thank you,",
    sign: "Operations — Traveliun",
    kind: { adult: "adult", child: "child", infant: "infant" },
  },
} as const;

/** The labels the seed and the edit form write into `detail`. */
const KEY_EN: Record<string, string> = {
  المدينة: "City",
  الغرفة: "Room",
  "عدد الغرف": "Rooms",
  "عدد الليالي": "Nights",
  النزلاء: "Guests",
  الذهاب: "Outbound",
  العودة: "Return",
  رحلة: "Flight",
  الدرجة: "Cabin",
  الركاب: "Passengers",
  الوقت: "Time",
  الرحلة: "Flight",
  "نقطة الالتقاء": "Meeting point",
  السيارة: "Vehicle",
  "عدد السيارات": "No. of cars",
  "رقم السيارة": "Plate no.",
  السائق: "Driver",
  "جوال السائق": "Driver mobile",
  "وقت الانطلاق": "Start time",
  البرنامج: "Programme",
  العدد: "Quantity",
  "نوع الغرفة": "Room type",
  الإقامة: "Board",
  "شركة الطيران": "Airline",
  "رقم الرحلة": "Flight no.",
  من: "From",
  إلى: "To",
  الإقلاع: "Departure",
  الوصول: "Arrival",
  الأمتعة: "Baggage",
};

/** The fixed phrases the seed writes into titles and values (seed-plan.ts, BOARD_AR). */
const PHRASES_EN: Record<string, string> = {
  "يُحدَّد لاحقاً": "TBC",
  "صالة القادمين": "Arrivals hall",
  "بهو الفندق": "Hotel lobby",
  "جولة سياحية في": "City tour in",
  "الجولات السياحية": "Tours",
  "طيران دولي": "International flight",
  "طيران داخلي": "Domestic flight",
  "شريحة اتصال": "SIM card",
  "غرفة فقط": "Room only",
  "شامل الإفطار": "Bed & breakfast",
  "نصف إقامة": "Half board",
  "إقامة كاملة": "Full board",
  "شامل كليًا": "All inclusive",
  الفندق: "the hotel",
  المطار: "Airport",
  فندق: "Hotel",
  جولة: "Tour",
  تأشيرة: "Visa",
  "←": "→",
  "،": ",",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Arabic → English, as far as the words we wrote ourselves go. Longest first, so
 * «بهو الفندق» is taken whole before «فندق» is. Plain substring replacement: `\b`
 * does not see Arabic letters. Whatever is left (a tour's free text) stays
 * Arabic, and the agent sees it in the review box before anything is sent.
 */
function toEnglish(text: string, glossary: Record<string, string>): string {
  const pairs = Object.entries({ ...PHRASES_EN, ...glossary })
    .filter(([ar, en]) => ar.trim() && en.trim())
    .sort((a, b) => b[0].length - a[0].length);
  let out = text
    .replace(/(\d+)\s*بالغ/g, (_, n: string) => plural(Number(n), "adult", "adults"))
    .replace(/(\d+)\s*طفل/g, (_, n: string) => plural(Number(n), "child", "children"))
    .replace(/(\d+)\s*رضيع/g, (_, n: string) => plural(Number(n), "infant", "infants"));
  for (const [ar, en] of pairs) out = out.replaceAll(ar, en);
  return out;
}

/** «الغرفة 2» → «Room 2»; an unknown label stays as it is. */
function keyToEnglish(key: string): string {
  if (KEY_EN[key]) return KEY_EN[key];
  const m = key.match(/^(.*\S)\s+(\d+)$/);
  return m && KEY_EN[m[1]] ? `${KEY_EN[m[1]]} ${m[2]}` : key;
}

export function buildSupplierRequest(input: SupplierRequestInput): { subject: string; body: string } {
  const L = TEXT[input.lang];
  const en = input.lang === "en";
  const say = (s: string) => (en ? toEnglish(s, input.glossary ?? {}) : s);
  const { booking } = input;

  const title = say(booking.title.trim()) || "—";
  const city = booking.city_name.trim();
  // a flight's «city» is its route, already in the title
  const showCity = city && booking.kind !== "flight" && !booking.title.includes(city);

  const dates: string[] = [];
  if (booking.kind === "hotel") {
    if (booking.start_date) dates.push(`${L.checkIn}: ${booking.start_date}`);
    if (booking.end_date) dates.push(`${L.checkOut}: ${booking.end_date}`);
  } else if (booking.start_date) {
    dates.push(
      booking.end_date && booking.end_date !== booking.start_date
        ? `${L.dates}: ${booking.start_date} → ${booking.end_date}`
        : `${L.date}: ${booking.start_date}`,
    );
  }

  const details = Object.entries(booking.detail ?? {})
    .filter(([k, v]) => v.trim() && !(showCity && k === "المدينة"))
    .map(([k, v]) => `• ${en ? keyToEnglish(k) : k}: ${say(v.trim())}`);

  const guests = input.travelers.filter((t) => t.name.trim());
  const body = [
    `${L.title} — ${L.company}`,
    "",
    L.greet(input.contact?.trim() || null),
    L.intro,
    "",
    `${L.reference}: ${input.reference || "—"}`,
    `${L.service}: ${title}`,
    showCity ? `${L.city}: ${say(city)}` : null,
    ...dates,
    ...details,
    "",
    `${L.guests}:`,
    ...(guests.length > 0
      ? guests.map((t, i) => `${i + 1}. ${t.name.trim()} (${L.kind[t.kind]})`)
      : [L.namesLater]),
    input.note?.trim() ? `\n${L.note}: ${input.note.trim()}` : null,
    "",
    L.thanks,
    L.sign,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  return { subject: `${L.title} ${input.reference} — ${title}`, body };
}

// ---------- the answer ----------

export type RequestState = "none" | "sent" | "overdue" | "confirmed" | "declined";

/**
 * Where the request stands. «Confirmed» is the booking's own status — the
 * confirmation number is what proves it, wherever it was typed. A request sent
 * before the booking was handed to someone else belongs to the previous
 * assignee and says nothing about the current one.
 */
export function requestState(
  b: { status: string; request_status: string | null; request_sent_at: string | null; assigned_at: string | null },
  now: Date,
  replyHours: number,
): RequestState {
  if (b.status === "confirmed") return "confirmed";
  if (b.status === "cancelled" || !b.request_sent_at) return "none";
  const sent = Date.parse(b.request_sent_at);
  if (!Number.isFinite(sent)) return "none";
  if (b.assigned_at && Date.parse(b.assigned_at) > sent) return "none";
  if (b.request_status === "declined") return "declined";
  return now.getTime() - sent >= replyHours * 3_600_000 ? "overdue" : "sent";
}

/** Whole hours since the request went out — what the reminder says. */
export const hoursSince = (iso: string, now: Date) => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 3_600_000));

// ---------- the account ----------

export type Money = { amount: number; currency: string };

/**
 * What a booking costs us: what the supplier actually charged, else the net it
 * was booked at (the offer's buy price, seeded with the booking), else the
 * offer's pricing line it came from.
 */
export function bookingCost(
  b: { net_charged: number | null; quoted_net: number | null; currency: string | null },
  fromOffer: Money | null = null,
): Money | null {
  const amount = b.net_charged ?? b.quoted_net;
  if (amount != null && Number.isFinite(Number(amount))) return { amount: Number(amount), currency: b.currency || "SAR" };
  return fromOffer;
}

export type SupplierBalance = { currency: string; owed: number; paid: number; balance: number };

/**
 * A supplier's account per currency — never summed across currencies. `owed` is
 * what their confirmed bookings cost, `paid` what we sent them less what they
 * refunded. balance > 0: we owe them; < 0: they owe us.
 */
export function supplierBalances(
  owed: Money[],
  payments: (Money & { kind: "payment" | "refund" })[],
): SupplierBalance[] {
  const by = new Map<string, SupplierBalance>();
  const row = (currency: string) => {
    let r = by.get(currency);
    if (!r) by.set(currency, (r = { currency, owed: 0, paid: 0, balance: 0 }));
    return r;
  };
  const cents = (n: number) => Math.round(n * 100) / 100;
  for (const o of owed) row(o.currency).owed = cents(row(o.currency).owed + o.amount);
  for (const p of payments) row(p.currency).paid = cents(row(p.currency).paid + (p.kind === "refund" ? -p.amount : p.amount));
  return [...by.values()].map((r) => ({ ...r, balance: cents(r.owed - r.paid) }));
}
