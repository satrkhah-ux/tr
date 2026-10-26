/**
 * «قارن» (the owner, 2026-10-26, option أ): deep links that open the public
 * sites BESIDE our system for the employee's own eyes — never an iframe (their
 * headers forbid it), never scraping, never a price read by code. The employee
 * copies the price there and PASTES it here; parsePastedPrice reads the number
 * and currency from whatever they pasted. Pure and client-safe.
 *
 * Verified 2026-10-26: Booking honours ss/checkin/checkout/group_adults/no_rooms
 * (dates and party arrived filled); Agoda and Almosafer do not reliably honour
 * query params, so theirs are name searches the employee completes.
 */

export type CompareLink = { key: "booking" | "agoda" | "almosafer"; label: string; url: string };

export type CompareQuery = {
  hotelName?: string | null;
  /** English city name when the catalogue has one — the public sites match it far better */
  cityEn?: string | null;
  cityAr: string;
  checkIn: string | null;
  checkOut: string | null;
  adults: number;
  rooms: number;
};

export function compareLinks(q: CompareQuery): CompareLink[] {
  const place = [q.hotelName?.trim(), q.cityEn?.trim() || q.cityAr.trim()].filter(Boolean).join(" ");
  const booking = new URLSearchParams({ ss: place, group_adults: String(Math.max(q.adults, 1)), no_rooms: String(Math.max(q.rooms, 1)), group_children: "0" });
  if (q.checkIn) booking.set("checkin", q.checkIn);
  if (q.checkOut) booking.set("checkout", q.checkOut);
  const agoda = new URLSearchParams({ textSearch: place, adults: String(Math.max(q.adults, 1)), rooms: String(Math.max(q.rooms, 1)) });
  if (q.checkIn) agoda.set("checkIn", q.checkIn);
  if (q.checkIn && q.checkOut) {
    const los = Math.round((Date.parse(q.checkOut) - Date.parse(q.checkIn)) / 86_400_000);
    if (los > 0) agoda.set("los", String(los));
  }
  return [
    { key: "booking", label: "Booking.com", url: `https://www.booking.com/searchresults.ar.html?${booking}` },
    { key: "agoda", label: "أجودا", url: `https://www.agoda.com/search?${agoda}` },
    { key: "almosafer", label: "المسافر", url: "https://www.almosafer.com/ar/hotels" },
  ];
}

/** an amount in another currency, through SAR (sarPer: SAR per 1 unit; SAR itself is 1) — null when a rate is missing */
export function convertAmount(amount: number, from: string, to: string, sarPer: Record<string, number>): number | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return amount;
  const inSar = f === "SAR" ? amount : sarPer[f] ? amount * sarPer[f] : null;
  if (inSar == null) return null;
  return t === "SAR" ? inSar : sarPer[t] ? inSar / sarPer[t] : null;
}

/**
 * «استخدم هذا السعر» in Basic: a pasted WHOLE-STAY price for all the stay's
 * rooms, in the stay's own currency, split per room (what a room's price holds
 * — the whole stay, DraftRoomSpec.price) and per night (what the field shows).
 */
export function pastedToRoomPrice(pasted: { amount: number; currency: string }, stay: { currency: string; nights: number; rooms: number }, sarPer: Record<string, number>): { perRoomStay: number; perRoomNight: number } | null {
  const total = convertAmount(pasted.amount, pasted.currency, stay.currency || "SAR", sarPer);
  if (total == null || total <= 0) return null;
  const rooms = Math.max(stay.rooms, 1);
  const nights = Math.max(stay.nights, 1);
  const perRoomStay = Math.round((total / rooms) * 100) / 100;
  return { perRoomStay, perRoomNight: Math.round((perRoomStay / nights) * 100) / 100 };
}

/** ١٬٢٣٤٫٥٦ and 1,234.56 alike; the currency from its word or sign, SAR assumed when none is said. */
export type PastedPrice = { amount: number; currency: string; assumed: boolean };

const CURRENCY_WORDS: [RegExp, string][] = [
  [/ر\.?\s?س|SAR|ريال/iu, "SAR"],
  [/USD|\$|دولار/iu, "USD"],
  [/AED|د\.?\s?إ|درهم/iu, "AED"],
  [/EUR|€|يورو/iu, "EUR"],
  [/GBP|£|جنيه\s*(إسترليني|استرليني)/iu, "GBP"],
  [/GEL|لاري/iu, "GEL"],
  [/TRY|₺|ليرة/iu, "TRY"],
];

export function parsePastedPrice(text: string): PastedPrice | null {
  if (!text?.trim()) return null;
  const western = text
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٬،]/g, ",")
    .replace(/٫/g, ".");
  // the largest number in the paste: a site line often also holds «لليلة 2» or stars
  const matches = western.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? [];
  const amounts = matches.map((m) => Number(m.replace(/,/g, ""))).filter((n) => Number.isFinite(n) && n > 0);
  if (!amounts.length) return null;
  const amount = Math.max(...amounts);
  const hit = CURRENCY_WORDS.find(([re]) => re.test(text));
  return { amount, currency: hit?.[1] ?? "SAR", assumed: !hit };
}
