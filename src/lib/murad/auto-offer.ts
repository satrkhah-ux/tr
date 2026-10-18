/**
 * «عرض آلي» (the owner, 2026-10-18): a client asking for a trip to a country
 * the company prices this way («ابي رحلة جورجيا 10 أيام») gets one question for
 * what is missing — the name, the arrival date, the days, the party — and then
 * a proposed programme with its price, sent by Murad; the file waits in Basic
 * for a colleague to confirm. Pure: the table, the nights, the price, the
 * words. The doing is reception-run.ts.
 *
 * The owner's defaults, agreed 2026-10-18: a car with driver per day, a hotel
 * room per night (a room for every two adults), the airport both ways, 15 %
 * on top, riyals at the system's rate, up to the whole riyal. Up to four
 * people in the car; more, or children, go to a colleague with no automatic
 * offer. No flights.
 */

import { cityKeys, emptyDraftData, normalizeDraftData, normalizeDraftHotel, type DraftData } from "@/lib/offer/draft-types";

export type OfferCity = { city: string; nights: number; hotel: string };

export type OfferCountry = {
  country: string;
  enabled: boolean;
  /** the route and its proportions — the ready offer's («تبليسي 2 + باكورياني 1 + باتومي 2 + تبليسي 1») */
  cities: OfferCity[];
  /** in `currency`: a car with driver per day, a room per night, one airport transfer */
  carPerDay: number;
  roomPerNight: number;
  transfer: number;
  currency: string;
  marginPct: number;
  maxPeople: number;
  includes: string[];
  excludes: string[];
};

export const DEFAULT_OFFERS: OfferCountry[] = [
  {
    country: "جورجيا",
    enabled: true,
    cities: [
      { city: "تبليسي", nights: 2, hotel: "Old Wall Tbilisi 4★" },
      { city: "باكورياني", nights: 1, hotel: "Dialog Kokhta Bakuriani 4★" },
      { city: "باتومي", nights: 2, hotel: "Black Sea 4★" },
      { city: "تبليسي", nights: 1, hotel: "Old Wall Tbilisi 4★" },
    ],
    carPerDay: 100,
    roomPerNight: 120,
    transfer: 25,
    currency: "USD",
    marginPct: 15,
    maxPeople: 4,
    includes: ["الإقامة في الفنادق المذكورة مع الإفطار", "سيارة خاصة مع سائق طوال أيام الرحلة", "الاستقبال والتوديع من المطار وإليه"],
    excludes: ["الطيران الدولي", "رسوم دخول الأماكن السياحية والأنشطة", "الغداء والعشاء"],
  },
];

/** The saved table (JSON), else the defaults. */
export function readOffers(raw: string | null | undefined): OfferCountry[] {
  try {
    const saved = JSON.parse(raw ?? "") as OfferCountry[];
    return Array.isArray(saved) && saved.length ? saved : DEFAULT_OFFERS;
  } catch {
    return DEFAULT_OFFERS;
  }
}

/**
 * The route over `total` nights, in the route's proportions (largest
 * remainder, a night at least in each city): 9 nights of 2/1/2/1 → 3/2/3/1.
 * Fewer nights than cities: all of them in the first.
 */
export function splitNights(cities: OfferCity[], total: number): OfferCity[] {
  if (total <= 0 || !cities.length) return [];
  if (total < cities.length) return [{ ...cities[0], nights: total }];
  const base = cities.reduce((n, c) => n + Math.max(c.nights, 1), 0);
  const raw = cities.map((c) => (Math.max(c.nights, 1) * total) / base);
  const out = raw.map((r) => Math.max(1, Math.floor(r)));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rest: r - Math.floor(r) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) out[order[k].i] += 1;
  for (let k = out.length - 1; left < 0 && k >= 0; k -= 1) {
    if (out[k] > 1) {
      out[k] -= 1;
      left += 1;
      k += 1;
    }
  }
  return cities.map((c, i) => ({ ...c, nights: out[i] }));
}

export type OfferAsk = { name: string | null; arrival: string | null; departure: string | null; days: number | null; adults: number | null; children: number | null };

/** What the trip still needs before a price: a name, its length, the party. A date is not needed — one is proposed. */
export function missing(a: OfferAsk): ("name" | "days" | "people")[] {
  const out: ("name" | "days" | "people")[] = [];
  if (!a.name) out.push("name");
  if (!tripDays(a)) out.push("days");
  if (!a.adults) out.push("people");
  return out;
}

/** The days: said, else from the two dates (both counted). */
export function tripDays(a: Pick<OfferAsk, "days" | "arrival" | "departure">): number | null {
  if (a.days && a.days > 1) return Math.min(a.days, 30);
  if (a.arrival && a.departure) {
    const d = Math.round((Date.parse(a.departure) - Date.parse(a.arrival)) / 86_400_000) + 1;
    return d > 1 && d <= 30 ? d : null;
  }
  return null;
}

/** Outside what Murad prices alone: a car seats four, and children's beds are a colleague's question. */
export function outOfRule(a: OfferAsk, c: OfferCountry): boolean {
  return (a.children ?? 0) > 0 || (a.adults ?? 0) + (a.children ?? 0) > c.maxPeople;
}

export type OfferPrice = { days: number; nights: number; rooms: number; cost: number; total: number; totalSar: number; currency: string; route: OfferCity[] };

/** The owner's price: car × days + room × nights × rooms + two transfers, the margin on top, riyals up to the whole one. */
export function priceOffer(c: OfferCountry, days: number, adults: number, sarPer: number): OfferPrice {
  const nights = Math.max(days - 1, 1);
  const rooms = Math.max(Math.ceil(adults / 2), 1);
  const cost = c.carPerDay * days + c.roomPerNight * nights * rooms + c.transfer * 2;
  const total = Math.round(cost * (1 + c.marginPct / 100) * 100) / 100;
  return { days, nights, rooms, cost, total, totalSar: Math.ceil(Math.round(total * sarPer * 100) / 100), currency: c.currency, route: splitNights(c.cities, nights) };
}

/** The one question — the first time all of it, the second time only what is still missing. */
export function askText(country: string, need: ("name" | "days" | "people")[], first: boolean, hasArrival = false): string {
  const words = { name: "الاسم", days: "عدد الأيام (أو تاريخ الوصول والمغادرة)", people: "عدد الأشخاص (بالغين وأطفال)" };
  if (first) {
    // only what is missing — and the arrival date, asked once but never required
    const items = [
      ...(need.includes("name") ? ["الاسم"] : []),
      ...(hasArrival ? [] : ["تاريخ الوصول"]),
      ...(need.includes("days") ? ["عدد الأيام"] : []),
      ...(need.includes("people") ? ["عدد الأشخاص (بالغين وأطفال)"] : []),
    ];
    return `حياك الله، عشان نجهز لك برنامج ${country}: تكرماً ${items.join("، و")}؟`;
  }
  return `شكراً لك، باقي فقط: ${need.map((n) => words[n]).join("، و")}؟`;
}

/** «ليلة واحدة» · «ليلتان» · «3 ليالٍ» · «11 ليلة» */
export const nightsText = (n: number) => (n === 1 ? "ليلة واحدة" : n === 2 ? "ليلتان" : n <= 10 ? `${n} ليالٍ` : `${n} ليلة`);
/** «غرفتان» · «3 غرف» */
const roomsText = (n: number) => (n === 2 ? "غرفتان" : n <= 10 ? `${n} غرف` : `${n} غرفة`);

const MONTHS = /(يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)|\d{1,2}\s*[/.-]\s*\d{1,2}/giu;

/** words that describe who travels, never who the client is */
const PARTY = /(^|\s)(انا|أنا|احنا|إحنا|نحن|مع)(\s|$)|زوج|عائل|عايل|طفل|أطفال|اطفال|شخص|اشخاص|أشخاص|نفر|ولد|بنت|عيال|اخو|أخو|اخت|أخت|صديق|ربع|\d/u;

/**
 * The model's dates, held to what the client wrote (it proposes a date when
 * none was said, and slips a year): a date counts only when the text names
 * one — a month, or «15/11» — the departure only when it names two; a past
 * year moves to the next one to come; with both dates the days are counted
 * from them, both days in.
 */
export function holdToText(text: string, a: OfferAsk, today: string): OfferAsk {
  // «نووفمبر»: a letter typed twice still names the month
  const said = (text.normalize("NFKC").replace(/(\p{L})\1+/gu, "$1").match(MONTHS) ?? []).length;
  const future = (d: string | null) => {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    let iso = d;
    for (let k = 0; iso < today && k < 5; k += 1) iso = `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
    return iso >= today ? iso : null;
  };
  const arrival = said >= 1 ? future(a.arrival) : null;
  let departure = said >= 2 ? future(a.departure) : null;
  if (arrival && departure && departure < arrival) departure = `${Number(departure.slice(0, 4)) + 1}${departure.slice(4)}`;
  // «انا وزوجتي» is the party, not a name (the manager's test, 2026-10-19: «أهلاً انا وزوجتي»)
  const name = a.name && !/^(null|none|غير معروف)$/i.test(a.name.trim()) && !PARTY.test(a.name) ? a.name.trim() : null;
  const days = arrival && departure ? tripDays({ days: null, arrival, departure }) : a.days;
  return { ...a, name, arrival, departure, days };
}

/**
 * The proposal as a Basic file, whole enough to issue (validateDraft): the
 * client, the dates, the route with a double room and breakfast in each hotel,
 * the car, no flights and no visa — and the price locked as a ready offer's is
 * (`source` + pricing.final_total), so no line asks for a price of its own.
 */
export function offerDraftData(i: { name: string; phone: string; c: OfferCountry; arrival: string; provisional: boolean; days: number; adults: number; price: OfferPrice }): DraftData {
  const base = emptyDraftData();
  const car = { enabled: true, car_type: "سيارة خاصة مع سائق", cars: 1, note: "" };
  const room = { room_type_id: null, room_type_name: "غرفة مزدوجة", board_type: "BB", price: null };
  // each hotel tied to ITS visit: Tbilisi twice (start and end) is two stays, not four (the manager, 2026-10-19: «فنادق مكرره»)
  const keys = cityKeys(i.price.route.map((r) => ({ city_name: r.city })));
  return normalizeDraftData({
    ...base,
    customer: { ...base.customer, customer_name: i.name, customer_phone: i.phone },
    trip: { ...base.trip, country: i.c.country, destination: i.c.country, arrival_date: i.arrival, days: i.days, nights: i.price.nights, adults: i.adults, children: 0, rooms: i.price.rooms, meal_plan: "breakfast", default_board: "BB" },
    scope: { ...base.scope, flights_intl: false, flights_domestic: false, visas: false },
    transport_plan: { airport: car, tours: car, intercity: { ...car, mode: "car" } },
    cities: i.price.route.map((r, k) => ({ key: keys[k], city_name: r.city, nights: r.nights, check_in: null, check_out: null })),
    hotels: i.price.route.map((r, k) => normalizeDraftHotel({ city_key: keys[k], city_name: r.city, hotel_name: r.hotel, rooms: Array.from({ length: i.price.rooms }, () => room) })),
    // what the message said, said on the document too
    services: { includes: i.c.includes, excludes: i.c.excludes, terms: ["هذا عرض مبدئي، ويؤكد معك موظفنا التفاصيل قبل الحجز.", ...(i.provisional ? ["التواريخ مبدئية وتُحدَّد معك عند التأكيد."] : [])] },
    pricing: { items: [], display_currency: "SAR", final_total: i.price.totalSar },
    source: { ready_offer_id: "murad", code: "murad", tier: "", title: `عرض آلي — ${i.c.country}`, valid_from: null, valid_to: null },
  } as unknown as Record<string, unknown>);
}

/** «15 نوفمبر» */
export function sayDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** The proposal, in one WhatsApp message. */
export function offerText(i: { name: string; country: string; price: OfferPrice; arrival: string; provisional: boolean; c: OfferCountry }): string {
  const lines = [
    `أهلاً ${i.name}، هذا برنامج ${i.country} المقترح لك:`,
    `🗓️ ${i.price.days} أيام / ${nightsText(i.price.nights)} — الوصول ${sayDate(i.arrival)}${i.provisional ? " (التواريخ مبدئية)" : ""}`,
    "",
    ...i.price.route.map((r) => `📍 ${r.city}: ${nightsText(r.nights)} — ${r.hotel}`),
    "",
    `💰 الإجمالي: ${i.price.totalSar.toLocaleString("en-US")} ريال${i.price.rooms > 1 ? ` (${roomsText(i.price.rooms)})` : ""}`,
    "",
    `✅ يشمل: ${i.c.includes.join("، ")}`,
    `❌ لا يشمل: ${i.c.excludes.join("، ")}`,
    "",
    "هذا عرض مبدئي، ويتواصل معك موظفنا لتأكيد التفاصيل والحجز.",
  ];
  return lines.join("\n");
}
