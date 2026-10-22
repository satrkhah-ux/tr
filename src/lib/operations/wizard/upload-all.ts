/**
 * «ارفع كل الملفات» (the owner, 2026-10-22: «يختار اسم العميل، يرفع الملفات
 * مرة واحدة الجواز و التذاكر و الفنادق، وهو يتعرف على كل الملفات و يسجل
 * الأمور وتبقى المراجعة») — which paper a file is, and where in the case it
 * belongs. The readers are the steps' own; this only sorts and places.
 *
 * Pure: no React, no Supabase.
 */
import type { OperationBooking } from "@/lib/data/operation-bookings";
import { normalizeTicketText, parseTicketText } from "@/lib/flights/ticket-parse";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { plannedLegs } from "./flights";
import { parseHotelConfirmation, sameHotel } from "./hotels";

/**
 * The money papers too (the owner, 2026-10-23: «فاتورة الفنادق و التذكرة و كم
 * سدد العميل»): a supplier's invoice for a hotel or a ticket, and the client's
 * payment slip (a transfer screenshot, a POS slip, a cash receipt).
 */
export type PaperKind = "passport" | "ticket" | "hotel" | "hotel_invoice" | "ticket_invoice" | "payment" | "unknown";

/** A passport's machine-readable first line: «P<SAUALTHAIBAN<<MOHAMMED<HADI<<<…». */
const MRZ = /^P[A-Z<][A-Z<]{3}[A-Z]+<<?[A-Z<]{5,}$/m;
const TICKET_WORDS = /E-?TICKET|ETKT|BOARDING|FLIGHT|AIRLINE|AIRWAYS|BAGGAGE|PNR|BOOKING\s*REF|ITINERARY|تذكرة|طيران|رحلة|الأمتعة|الخطوط/g;
const HOTEL_WORDS = /HOTEL|RESORT|CHECK[\s-]?IN|CHECK[\s-]?OUT|NIGHTS?|ROOM|GUEST|فندق|منتجع|الدخول|الخروج|ليال|ليلة|غرفة|نزيل/g;
const INVOICE_WORDS = /INVOICE|فاتورة/g;
const PAYMENT_WORDS = /TRANSFER|TRANSACTION|BENEFICIARY|IBAN|SENDER|APPROVED|MADA|STC\s*PAY|APPLE\s*PAY|حوالة|تحويل|المستفيد|المرسل|مدى|مقبولة|رقم\s*العملية|سند\s*قبض|إيصال/g;
/** A total on the paper — what an invoice inside an e-ticket's PDF prints. */
const TOTAL = /TOTAL|AMOUNT\s*(?:DUE|PAID)|الإجمالي|الاجمالي|المجموع|المبلغ/;

/**
 * A paper's words → what it is. A passport by its MRZ line; a ticket and a
 * hotel confirmation by what their own readers find (legs; a stay's two
 * dates) and the words they print. Too little either way, or a tie: unknown —
 * the employee places it.
 */
export function paperKind(text: string): PaperKind {
  const upper = normalizeTicketText(text).toUpperCase();
  if (MRZ.test(upper.replace(/ /g, "").replace(/«/g, "<"))) return "passport";
  const words = (re: RegExp) => Math.min(6, (upper.match(re) ?? []).length);
  const stay = parseHotelConfirmation(text);
  const legs = parseTicketText(text).legs.length;
  const ticket = legs * 3 + words(TICKET_WORDS);
  const hotel = (stay.check_in ? 2 : 0) + (stay.check_out ? 2 : 0) + words(HOTEL_WORDS);
  const invoice = words(INVOICE_WORDS);
  // a bank transfer or a POS slip: a payment's words, no invoice, no trip in it
  if (words(PAYMENT_WORDS) >= 2 && invoice === 0 && ticket < 6 && hotel < 4) return "payment";
  // an invoice names itself; one inside an e-ticket's PDF stays the ticket (ticketInvoice adds its line)
  if (invoice > 0 && legs === 0 && ticket !== hotel) return ticket > hotel ? "ticket_invoice" : "hotel_invoice";
  if (Math.max(ticket, hotel) < 3 || ticket === hotel) return "unknown";
  return ticket > hotel ? "ticket" : "hotel";
}

/** An e-ticket's PDF that carries its invoice or receipt too — read as both papers. */
export const ticketInvoice = (text: string): boolean => /INVOICE|RECEIPT|فاتورة|إيصال/i.test(text) && TOTAL.test(normalizeTicketText(text).toUpperCase());

const CURRENCY: [RegExp, string][] = [
  [/\bSAR\b|ر\.?\s?س|ريال/i, "SAR"],
  [/\bUSD\b|US\$|\$|دولار/i, "USD"],
  [/\bEUR\b|€|يورو/i, "EUR"],
  [/\bTRY\b|\bTL\b|ليرة/i, "TRY"],
  [/\bAED\b|درهم/i, "AED"],
  [/\bGEL\b|لاري/i, "GEL"],
  [/\bMYR\b|\bRM\b|رينغيت/i, "MYR"],
  [/\bIDR\b|روبية/i, "IDR"],
  [/\bTHB\b/i, "THB"],
  [/\bGBP\b|£|جنيه/i, "GBP"],
];
const NUMBER = /(\d{1,3}(?:[,٬]\d{3})+(?:[.٫]\d{1,2})?|\d+(?:[.٫]\d{1,2})?)/g;

/**
 * A paper's amount and currency without the model: the biggest number on the
 * lines that say «total» (else on any line naming a currency), and the first
 * currency the paper names. The model's reading wins where it has one.
 */
export function amountIn(text: string): { amount: number | null; currency: string | null } {
  const lines = normalizeTicketText(text).split("\n");
  const pick = (only: (l: string) => boolean) =>
    Math.max(0, ...lines.filter(only).flatMap((l) => [...l.matchAll(NUMBER)].map((m) => Number(m[1].replace(/[,٬]/g, "").replace("٫", ".")))).filter((n) => n < 10_000_000));
  const currencyOf = (l: string) => CURRENCY.find(([re]) => re.test(l))?.[1] ?? null;
  const total = pick((l) => TOTAL.test(l.toUpperCase()));
  const amount = total || pick((l) => currencyOf(l) !== null);
  return { amount: amount > 0 ? amount : null, currency: currencyOf(text) };
}

export type StayTarget = { id: string; names: (string | null)[]; start_date: string | null; end_date: string | null; city?: string | null };

/**
 * A stay read off an outside paper → its hotel booking. By the hotel's NAME
 * first (sameHotel: the booking's title and its catalogue names, either
 * script) — a paper naming another hotel is never put on the file's only one
 * (the owner's samples, 2026-10-23); among those, the check-in day. A paper
 * that names no hotel goes by its check-in day alone. `other`: the paper names
 * a hotel the file does not have.
 */
export function placeStay(stay: { hotel_name: string; check_in: string; check_out: string }, bookings: StayTarget[]): { target: string | null; other: boolean } {
  if (stay.hotel_name.trim()) {
    const named = bookings.filter((b) => sameHotel(stay.hotel_name, b.names, [b.city, "city" in stay ? (stay as { city?: string }).city : null]));
    if (named.length === 0) return { target: null, other: true };
    const day = named.find((b) => stay.check_in && b.start_date === stay.check_in) ?? named.find((b) => stay.check_in && b.start_date && b.end_date && stay.check_in >= b.start_date && stay.check_in < b.end_date);
    return { target: (day ?? named[0]).id, other: false };
  }
  const day = bookings.find((b) => stay.check_in && b.start_date === stay.check_in && (!stay.check_out || b.end_date === stay.check_out));
  return { target: day?.id ?? null, other: false };
}

const HOTEL_HEAD = /^(?:HOTEL(?:\s*NAME)?|PROPERTY(?:\s*NAME)?|ACCOMMODATION|اسم\s*الفندق|الفندق|الفندق\s*المحجوز)\s*[:：]/iu;
const CHECK_IN_LINE = /CHECK[\s-]?IN|تاريخ\s*الوصول|تسجيل\s*الدخول/iu;

/**
 * A supplier's voucher that holds several hotels (a TBO itinerary, the
 * owner's evaluator, 2026-10-23) as one paper per hotel: split where a hotel's
 * own block begins — its «Hotel:» line, else a check-in again, taking the two
 * lines over it (the hotel's name) — each block with the paper's head (the
 * booking reference, the lead guest) before it. One hotel: the paper whole.
 */
export function splitStays(text: string): string[] {
  const lines = normalizeTicketText(text).split("\n");
  let starts = lines.flatMap((l, i) => (HOTEL_HEAD.test(l.trim()) ? [i] : []));
  if (starts.length < 2) {
    const checks = lines.flatMap((l, i) => (CHECK_IN_LINE.test(l) ? [i] : []));
    if (checks.length < 2) return [text];
    starts = checks.map((c, k) => Math.max(c - 2, k === 0 ? 0 : checks[k - 1] + 1));
  }
  const head = lines.slice(0, starts[0]).join("\n");
  return starts.map((s, k) => [head, ...lines.slice(s, starts[k + 1] ?? lines.length)].join("\n").trim());
}

/** Words a company's name carries beside its own: «Booking.com» is Booking, «… Tourism LLC» the same company. */
const COMPANY = new Set("com net llc co ltd inc est company group".split(" "));
const runIn = (hay: string[], run: string[]) => hay.some((_, i) => run.every((w, j) => hay[i + j] === w));

/**
 * The paper's issuer among our suppliers: the same name folded — Arabic or
 * Latin, case, spaces and marks aside («Within Earth» is «within earth») — else
 * a supplier's whole name among the issuer's words, in order: a name of two
 * words or more anywhere in it («Within Earth Tourism LLC»), a one-word name
 * only as the issuer's whole name («Booking» for «Booking.com»). Never a word
 * inside a phrase — «Booking Reference» is no بوكينج, «TRIP TO DENPASAR» no
 * Trip (the evaluator, 2026-10-23). null: a new one, offered to the employee,
 * never made by itself.
 */
export function matchSupplier<T extends { id: string; arabic_name: string; english_name: string | null }>(issuer: string, suppliers: T[]): T | null {
  const fold = (v: string | null) => normalizeName(v).replace(/[^\p{L}\p{N}]+/gu, "");
  const words = (v: string | null) => normalizeName(v).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const name = fold(issuer);
  if (name.length < 3) return null;
  const exact = suppliers.find((s) => [fold(s.arabic_name), fold(s.english_name)].includes(name));
  if (exact) return exact;
  const own = words(issuer);
  const bare = own.filter((w) => !COMPANY.has(w));
  const fits = (n: string[]) => (n.length >= 2 ? runIn(own, n) : n.length === 1 && bare.length === 1 && bare[0] === n[0]);
  let best: { s: T; n: number } | null = null;
  for (const s of suppliers) {
    for (const n of [words(s.arabic_name), words(s.english_name)]) if (fits(n) && (!best || n.length > best.n)) best = { s, n: n.length };
  }
  return best?.s ?? null;
}

type Leg = { from_iata: string; to_iata: string; dep_date: string };
type FlightBooking = Pick<OperationBooking, "id" | "start_date" | "end_date"> & { detail: OperationBooking["detail"] | null };

/**
 * A ticket's flight booking: the one whose planned legs it flies — the same
 * airports (2 a leg), on the same day (1 more) — else, when a booking plans no
 * legs, the one whose dates hold its first take-off. A case with one flight
 * booking takes a ticket that says nothing against it — never one flying
 * elsewhere (a domestic hop on its own ticket, the owner's samples). null: the
 * employee places it.
 */
export function matchTicket(legs: Leg[], flights: FlightBooking[]): string | null {
  if (flights.length === 1 && (legs.length === 0 || (plannedLegs(flights[0].detail ?? {}).length === 0 && !flights[0].start_date))) return flights[0].id;
  let best: { id: string; score: number } | null = null;
  for (const f of flights) {
    const planned = plannedLegs(f.detail ?? {});
    let score = 0;
    for (const l of legs) {
      const hit = planned.find((p) => p.from_iata === l.from_iata && p.to_iata === l.to_iata);
      if (hit) score += 2 + (hit.dep_date && hit.dep_date === l.dep_date ? 1 : 0);
    }
    const first = legs[0]?.dep_date;
    if ((score > 0 || planned.length === 0) && first && f.start_date && f.end_date && first >= f.start_date && first <= f.end_date) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { id: f.id, score };
  }
  return best?.id ?? null;
}

type HotelBooking = Pick<OperationBooking, "id" | "title" | "city_name" | "start_date" | "end_date">;

/** Words every hotel's name may hold — «Crystal Hotel & SPA» is not «… Resort & Spa» (AD-5-3269). */
const GENERIC = new Set("hotel hotels resort resorts spa suites suite inn the and by apartments villa villas فندق منتجع سبا اجنحه شقق فيلا".split(" "));
const wordsOf = (text: string) => normalizeName(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * A confirmation's hotel booking: the check-in day (3) and check-out day (2)
 * the paper prints, the hotel's name in its words (2 when most of the name's
 * own words are there — not «hotel» or «spa»), its city (1). A case with one
 * hotel takes it.
 */
export function matchHotel(text: string, hotels: HotelBooking[]): string | null {
  if (hotels.length === 1) return hotels[0].id;
  const stay = parseHotelConfirmation(text);
  const words = new Set(wordsOf(text));
  const share = (name: string) => {
    const own = wordsOf(name).filter((w) => w.length > 2 && !GENERIC.has(w));
    return own.length > 0 && own.filter((w) => words.has(w)).length / own.length >= 0.5;
  };
  let best: { id: string; score: number } | null = null;
  for (const h of hotels) {
    const score =
      (stay.check_in && stay.check_in === h.start_date ? 3 : 0) +
      (stay.check_out && stay.check_out === h.end_date ? 2 : 0) +
      (share(h.title) ? 2 : 0) +
      (h.city_name && share(h.city_name) ? 1 : 0);
    if (score >= 2 && (!best || score > best.score)) best = { id: h.id, score };
  }
  return best?.id ?? null;
}
