/**
 * The reference data's shape, read off a name (data section orders 4–8).
 *
 * The catalogue was typed by many people over years: a room is «Deluxe King»,
 * «غرفة مزدوجة», «A-1 (3 غرف نوم)»; a car is «باص 40 راكب»; a tour is
 * «جولة كوالالمبور (فان)». These read the meaning out of the name — for the
 * proposals that fill the new columns (0072), and for the screens until a
 * reviewed value is stored.
 *
 * Pure and import-free, like ./norm: the maintenance scripts import this file
 * directly (Node strips the types), so the app and the scripts classify alike.
 * The patterns accept the spellings unfolded (ة/ه, ى/ي, أ/ا) instead of folding.
 */

// ---------- room types (order 4) ----------

/** The unified room categories, in the order a hotel's rooms are offered. */
export const ROOM_CATEGORIES = [
  "single",
  "double",
  "twin",
  "triple",
  "quad",
  "family",
  "connecting",
  "standard",
  "superior",
  "deluxe",
  "executive",
  "suite",
  "studio",
  "apartment",
  "villa",
  "chalet",
  "bungalow",
] as const;
export type RoomCategory = (typeof ROOM_CATEGORIES)[number];

/**
 * First match wins: what the unit IS (a villa, a suite) before who sleeps in it
 * (twin, triple), before its grade (deluxe). «Deluxe Twin» is a twin — the
 * occupancy is what the agent matches to the travellers.
 */
const ROOM_RULES: [RoomCategory, RegExp][] = [
  // \b does not see Arabic letters as a word — a space or the end marks «فلة» alone
  ["villa", /فيلا|فلل|(?:^|\s)فل[ةه](?:\s|$)|villa/i],
  ["chalet", /شالي[ةه]|chalet/i],
  ["bungalow", /بنغل|بنجل|بانجلو|كوخ|[اأ]كواخ|bungalow|cabin|cottage/i],
  ["suite", /جناح|[اأ]جنح|سويت|suite/i],
  ["apartment", /شق[ةه]|شقق|غرف(?:[ةه]|تين|تان)? نوم|apartment|\bapt\b|bedroom/i],
  ["studio", /[اإ]?ستوديو|studio/i],
  ["family", /عائلي|family/i],
  ["connecting", /متصل|interconnect|connecting|adjoining/i],
  ["quad", /رباعي|quad/i],
  ["triple", /ثلاثي|triple|\btrpl\b/i],
  ["twin", /تو[أا]م|سريرين|منفصل|twin/i],
  ["double", /مزدوج|دبل|كينج|كنج|كوين|double|\bdbl\b|king|queen/i],
  ["single", /مفرد|فردي|سنجل|single|\bsgl\b/i],
  ["executive", /تنفيذي|[اإ]كزكيوتف|كلوب|executive|club/i],
  ["deluxe", /ديلوكس|ديلكس|بريمي?ير|deluxe|delux|premier|premium/i],
  ["superior", /سوبي?ري?ي?ور|سوبيرير|superior/i],
  ["standard", /قياسي|[اإ]?ستاندر|كلاسيك|عادي|standard|classic|\bstd\b/i],
];

/** The category a room type's name says, or null when it says none. */
export function classifyRoom(arabic: string | null | undefined, english?: string | null): RoomCategory | null {
  const text = `${arabic ?? ""} ${english ?? ""}`;
  for (const [category, rule] of ROOM_RULES) if (rule.test(text)) return category;
  return null;
}

/** Where a room is offered among a hotel's rooms: by its category, the unclassified last. */
export function roomRank(name: string): number {
  const category = classifyRoom(name);
  return category ? ROOM_CATEGORIES.indexOf(category) : ROOM_CATEGORIES.length;
}

/**
 * Why a room-type row is not a room at all — evidence for a person, never
 * grounds on its own: a unit code («A-1 (3 غرف نوم)», «B12»), or two rooms
 * joined into one name («غرفة مزدوجة + غرفة مفردة»). An extra bed added to a
 * room («… + سرير إضافي») is still one room. A hotel's NAME filed as a room is
 * caught by looksLikeHotel (./norm).
 */
export function nonRoomReason(name: string | null | undefined): "code" | "combo" | null {
  const text = (name ?? "").trim();
  if (!text) return null;
  if (/^[A-Z]{1,3}\s*-?\s*\d+\b/i.test(text) || /^[A-Z0-9-]{1,5}$/i.test(text)) return "code";
  const rooms = text.split("+").filter((part) => /غرف|room|جناح|suite/i.test(part));
  return rooms.length >= 2 ? "combo" : null;
}

// ---------- airports, stations, ports (order 5) ----------

/** What a row of /airports is (airports.kind, 0072). Only an airport has an IATA code. */
export const PLACE_KINDS = ["airport", "train_station", "bus_station", "port"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

const PLACE_RULES: [PlaceKind, RegExp][] = [
  ["port", /ميناء|مرف[أا]|رصيف|مارينا|عبّ?ار|ferry|\bport\b|pier|jetty|harbou?r|marina/i],
  ["train_station", /قطار|سكك|train|railway|\brail\b|sentral/i],
  ["bus_station", /حافل|باص|[اأ]توبيس|\bbus\b|coach|bersepadu|\btbs\b/i],
  ["airport", /مطار|airport/i],
];

/** The kind a place's name says; an unmarked name stays an airport (the column's default). */
export function guessPlaceKind(arabic: string | null | undefined, english?: string | null): PlaceKind {
  const text = `${arabic ?? ""} ${english ?? ""}`;
  for (const [kind, rule] of PLACE_RULES) if (rule.test(text)) return kind;
  return "airport";
}

/** What is wrong with a row's IATA code, if anything: three capital letters, on an airport only. */
export function iataProblem(code: string | null | undefined, kind: PlaceKind): "not_airport" | "format" | null {
  if (!code) return null;
  if (kind !== "airport") return "not_airport";
  return /^[A-Z]{3}$/.test(code) ? null : "format";
}

// ---------- cars and tours (orders 7, 8) ----------

/**
 * The seats a vehicle's name states — «باص 40 راكب», «ميني باص 16 مقعد»,
 * «Hiace 10 seats», «7-seater». The fallback for a car type whose
 * pax_capacity was never filled.
 */
export function seatsFromName(name: string | null | undefined): number | null {
  const m = (name ?? "").match(/(\d{1,2})\s*-?\s*(?:راكب|ركاب|مقعد|مقاعد|[اأ]شخاص|شخص|seats?|seater|pax|passengers?|persons?)/i);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 80 ? n : null;
}

/**
 * The tour and the vehicle in one of the old per-car names:
 * «جولة كوالالمبور (فان)» → { base: «جولة كوالالمبور», car: «فان» }.
 */
export function splitTourName(name: string | null | undefined): { base: string; car: string } | null {
  const m = (name ?? "").match(/^(.*\S)\s*\(([^()]+)\)\s*$/);
  return m ? { base: m[1].trim(), car: m[2].trim() } : null;
}
