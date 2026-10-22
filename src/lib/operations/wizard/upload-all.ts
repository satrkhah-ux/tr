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
import { parseHotelConfirmation } from "./hotels";

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

/**
 * The invoice's issuer among our suppliers: the same name folded — Arabic or
 * Latin, case, spaces and marks aside («Within Earth» is «within earth») — or
 * one name holding the other («Within Earth Travel LLC»). null: a new one,
 * offered to the employee, never made by itself.
 */
export function matchSupplier<T extends { id: string; arabic_name: string; english_name: string | null }>(issuer: string, suppliers: T[]): T | null {
  const fold = (v: string | null) => normalizeName(v).replace(/[^\p{L}\p{N}]+/gu, "");
  const name = fold(issuer);
  if (name.length < 3) return null;
  const names = (s: T) => [fold(s.arabic_name), fold(s.english_name)].filter((n) => n.length >= 3);
  return suppliers.find((s) => names(s).includes(name)) ?? suppliers.find((s) => names(s).some((n) => n.length >= 5 && (name.includes(n) || n.includes(name)))) ?? null;
}

type Leg = { from_iata: string; to_iata: string; dep_date: string };
type FlightBooking = Pick<OperationBooking, "id" | "start_date" | "end_date" | "detail">;

/**
 * A ticket's flight booking: the one whose planned legs it flies — the same
 * airports (2 a leg), on the same day (1 more) — else the one whose dates hold
 * its first take-off. A case with one flight booking takes it. null: the
 * employee places it.
 */
export function matchTicket(legs: Leg[], flights: FlightBooking[]): string | null {
  if (flights.length === 1) return flights[0].id;
  let best: { id: string; score: number } | null = null;
  for (const f of flights) {
    const planned = plannedLegs(f.detail ?? {});
    let score = 0;
    for (const l of legs) {
      const hit = planned.find((p) => p.from_iata === l.from_iata && p.to_iata === l.to_iata);
      if (hit) score += 2 + (hit.dep_date && hit.dep_date === l.dep_date ? 1 : 0);
    }
    const first = legs[0]?.dep_date;
    if (first && f.start_date && f.end_date && first >= f.start_date && first <= f.end_date) score += 1;
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
