/**
 * Repackage model — THE contract between the /repackage stage pages, the shell,
 * the extraction engine, validation, and the produce→publish pipeline.
 *
 * Mirrors the package-generator draft model (src/lib/offer/draft-types.ts): one
 * `repackage_imports` row whose `data` jsonb holds these slices. Pure module: no
 * React, no Supabase, no `node:*` — safe to import anywhere (client/server/tests).
 *
 * Flow: import a supplier PDF → `extracted` (facts) + `confidence` (per field) →
 * confidence-gated `review` (correct only the uncertain criticals) → `edit`
 * (price via markup + services + terms, with a before→after diff) → produce a
 * Traveliun-branded Offer (reuses createOffer/publishOffer/OfferDocument).
 */

import type { TranslationKey } from "@/lib/i18n";
import type { BoardType } from "@/lib/types";
import { cityKeys, withCityKeys } from "@/lib/offer/draft-types";
import { localDatePart, withDatePart } from "@/lib/offer/schedule";

// ---------- stage registry ----------
export const STAGE_KEYS = ["import", "review", "edit", "preview"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export type StageMeta = {
  key: StageKey;
  labelKey: TranslationKey;
  /** stage requires the pricing.view permission (shows sell) — hidden otherwise. */
  gated?: boolean;
};

export const STAGES: StageMeta[] = [
  { key: "import", labelKey: "rp.stage.import" },
  { key: "review", labelKey: "rp.stage.review" },
  { key: "edit", labelKey: "rp.stage.edit", gated: true },
  { key: "preview", labelKey: "rp.stage.preview" },
];

export function stageHref(draftId: string, stage: StageKey): string {
  return `/repackage/${draftId}/${stage}`;
}

// ---------- extracted facts (the typed extraction schema) ----------
export type ExtractedCity = {
  /**
   * This stop's identity — a city visited twice (تبليسي first and last) is two
   * stops, each with its own hotel. Written by normalize (cityKeys, as the
   * generator's DraftCity.key); a hotel points at it through `city_key`.
   */
  key?: string;
  city_name: string;
  nights: number | null;
};

export type ExtractedHotel = {
  /** the stop this hotel is for (ExtractedCity.key) — see keyHotels. */
  city_key?: string;
  city_name: string;
  hotel_name: string;
  room_type: string;
  /** raw board text as read (BB/HB/FB/AI/RO or Arabic); normalized later. */
  board: string;
  nights: number | null;
  check_in: string | null;
  check_out: string | null;
};

export type ExtractedFlight = {
  airline: string;
  flight_no: string;
  from_airport: string;
  to_airport: string;
  departure_at: string | null;
  arrival_at: string | null;
  /** typed by the agent in «إضافات» — the supplier's file did not hold it. */
  added?: true;
};

/**
 * The structured FACTS read from the supplier PDF. This is the working model:
 * it starts from extraction and is corrected (review) + edited (edit) in place.
 * Client-safe facts only — the supplier's COST lives in `supplier_total`
 * (mapped to buy_price internally, never shipped to a client).
 */
export type ExtractedPackage = {
  /**
   * What the FILE named as its traveller, if it did. The client the offer is
   * for is `RepackageData.customer` (known from the moment the file is started,
   * before any import) — this is only a fallback the import may seed it from.
   */
  customer_name: string;
  customer_phone: string;
  destination: string;
  country: string;
  cities: ExtractedCity[];
  trip_nights: number | null;
  arrival_date: string | null;
  departure_date: string | null;
  adults: number;
  children: number;
  infants: number;
  hotels: ExtractedHotel[];
  flights: ExtractedFlight[];
  transfers: string[];
  includes: string[];
  excludes: string[];
  visas: string[];
  terms: string[];
  /** the SUPPLIER'S price = our internal cost basis (buy). NEVER shown to clients. */
  supplier_total: number | null;
  supplier_currency: string;
};

// ---------- per-field confidence ----------
export type ConfidenceFieldKey =
  | "destination"
  | "country"
  | "cities"
  | "trip_nights"
  | "dates"
  | "pax"
  | "hotels"
  | "flights"
  | "includes"
  | "excludes"
  | "terms"
  | "supplier_total";

export const CONFIDENCE_FIELD_KEYS: ConfidenceFieldKey[] = [
  "destination",
  "country",
  "cities",
  "trip_nights",
  "dates",
  "pax",
  "hotels",
  "flights",
  "includes",
  "excludes",
  "terms",
  "supplier_total",
];

/** Critical fields — the offer is unsafe to auto-advance unless ALL are confident. */
export const CRITICAL_FIELDS: ConfidenceFieldKey[] = [
  "country",
  "cities",
  "trip_nights",
  "hotels",
  "supplier_total",
];

/** Score below this = "غير مؤكد" (low confidence → must be reviewed). */
export const CONFIDENCE_THRESHOLD = 0.7;

export type ConfidenceMap = Partial<Record<ConfidenceFieldKey, number>>;

// ---------- slices ----------
export type RepackageSource = {
  supplier_name: string;
  supplier_id: string | null;
  /**
   * The registered supplier (company_suppliers — the one that holds contact
   * data) this package is bought from; null until the order screen finds it by
   * name or the employee picks / types it once. suppliers_repackage is only a
   * name list, so the link lives here, in the jsonb — no column needed.
   */
  company_supplier_id: string | null;
  /** Storage path of the original file — internal audit only, NEVER on client output. */
  original_file_path: string | null;
  pdf_kind: "text" | "scanned" | null;
  ocr_used: boolean;
  /** true when the PDF was scanned but no OCR provider was configured. */
  ocr_unavailable: boolean;
  imported_at: string | null;
  /** which reader produced the fields: the model (text/vision) or the parser. */
  how: "ai-text" | "ai-vision" | "parser" | "none" | null;
  /** the model's short Arabic recap of the document. */
  summary: string;
};

/** Frozen at first edit so the edit stage can render a before→after diff. */
export type RepackageBefore = {
  supplier_total: number | null;
  supplier_currency: string;
  includes: string[];
  excludes: string[];
  terms: string[];
};

/** The client this repackage is FOR — asked when it is started, linked later if it was not. */
export type RepackageCustomer = { customer_name: string; customer_phone: string };

/**
 * One line the agent adds to what the supplier's file held — an extra tour, a
 * transfer, a SIM. Printed in the client's «يشمل» list, and, when it has a
 * price, added to the client's total (its own pricing line, cost left empty).
 * SELL-ONLY: there is no field for a cost here.
 */
export type RepackageAddition = {
  id: string;
  title: string;
  detail: string;
  /** what the client pays for it on top of the package; null = included at no charge. */
  sell_price: number | null;
};

export type RepackageData = {
  source: RepackageSource;
  /** who the offer is for — one source of truth for the document, the produced offer and the list. */
  customer: RepackageCustomer;
  /** the working package (null until a file is imported). */
  extracted: ExtractedPackage | null;
  /** per-field extraction confidence (0..1). */
  confidence: ConfidenceMap;
  /** field keys the human has confirmed/corrected in /review. */
  reviewed: ConfidenceFieldKey[];
  /** what the agent added to the supplier's package (edit stage «إضافات»). */
  additions: RepackageAddition[];
  /** our SELL price of the supplier's package itself (edit stage); additions are priced on top of it. */
  final_total: number | null;
  final_currency: string;
  /** true when the sell was produced by the markup engine (vs typed by hand). */
  markup_applied: boolean;
  /** immutable import snapshot for the diff. */
  before: RepackageBefore | null;
  /** set once re-issued into a real Offer. */
  produced_serial: string | null;
};

export function emptyExtractedPackage(): ExtractedPackage {
  return {
    customer_name: "",
    customer_phone: "",
    destination: "",
    country: "",
    cities: [],
    trip_nights: null,
    arrival_date: null,
    departure_date: null,
    adults: 2,
    children: 0,
    infants: 0,
    hotels: [],
    flights: [],
    transfers: [],
    includes: [],
    excludes: [],
    visas: [],
    terms: [],
    supplier_total: null,
    supplier_currency: "SAR",
  };
}

export function emptyRepackageData(): RepackageData {
  return {
    source: {
      supplier_name: "",
      supplier_id: null,
      company_supplier_id: null,
      original_file_path: null,
      pdf_kind: null,
      ocr_used: false,
      ocr_unavailable: false,
      imported_at: null,
      how: null,
      summary: "",
    },
    customer: { customer_name: "", customer_phone: "" },
    extracted: null,
    confidence: {},
    reviewed: [],
    additions: [],
    final_total: null,
    final_currency: "SAR",
    markup_applied: false,
    before: null,
    produced_serial: null,
  };
}

// ---------- tolerant normalizer (jsonb has no schema) ----------
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function intOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function normalizeExtracted(raw: unknown): ExtractedPackage | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Partial<ExtractedPackage>;
  const empty = emptyExtractedPackage();
  const cities = withCityKeys(
    Array.isArray(e.cities)
      ? e.cities.map((c) => {
          const cc = (c ?? {}) as Partial<ExtractedCity>;
          return {
            ...(typeof cc.key === "string" && cc.key ? { key: cc.key } : {}),
            city_name: str(cc.city_name),
            nights: numOrNull(cc.nights),
          };
        })
      : [],
  );
  return {
    customer_name: str(e.customer_name),
    customer_phone: str(e.customer_phone),
    destination: str(e.destination),
    country: str(e.country),
    cities,
    trip_nights: numOrNull(e.trip_nights),
    arrival_date: typeof e.arrival_date === "string" ? e.arrival_date : null,
    departure_date: typeof e.departure_date === "string" ? e.departure_date : null,
    adults: intOr(e.adults, 2),
    children: intOr(e.children, 0),
    infants: intOr(e.infants, 0),
    // a package saved before stops had keys gets its hotels keyed here
    hotels: keyHotels(cities, Array.isArray(e.hotels)
      ? e.hotels.map((h) => {
          const hh = (h ?? {}) as Partial<ExtractedHotel>;
          return {
            ...(typeof hh.city_key === "string" && hh.city_key ? { city_key: hh.city_key } : {}),
            city_name: str(hh.city_name),
            hotel_name: str(hh.hotel_name),
            room_type: str(hh.room_type),
            board: str(hh.board),
            nights: numOrNull(hh.nights),
            check_in: typeof hh.check_in === "string" ? hh.check_in : null,
            check_out: typeof hh.check_out === "string" ? hh.check_out : null,
          };
        })
      : []),
    flights: Array.isArray(e.flights)
      ? e.flights.map((f) => {
          const ff = (f ?? {}) as Partial<ExtractedFlight>;
          return {
            airline: str(ff.airline),
            flight_no: str(ff.flight_no),
            from_airport: str(ff.from_airport),
            to_airport: str(ff.to_airport),
            departure_at: typeof ff.departure_at === "string" ? ff.departure_at : null,
            arrival_at: typeof ff.arrival_at === "string" ? ff.arrival_at : null,
            ...(ff.added === true ? { added: true as const } : {}),
          };
        })
      : [],
    transfers: strArr(e.transfers),
    includes: strArr(e.includes),
    excludes: strArr(e.excludes),
    visas: strArr(e.visas),
    terms: strArr(e.terms),
    supplier_total: numOrNull(e.supplier_total),
    supplier_currency: str(e.supplier_currency, empty.supplier_currency),
  };
}

function normalizeAdditions(raw: unknown): RepackageAddition[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a, i) => {
    const aa = (a ?? {}) as Partial<RepackageAddition>;
    const price = numOrNull(aa.sell_price);
    return {
      id: typeof aa.id === "string" && aa.id ? aa.id : `add-${i + 1}`,
      title: str(aa.title),
      detail: str(aa.detail),
      // a price is money the client pays: never negative
      sell_price: price != null && price >= 0 ? price : null,
    };
  });
}

export function normalizeRepackageData(raw: Record<string, unknown> | null | undefined): RepackageData {
  const empty = emptyRepackageData();
  if (!raw || typeof raw !== "object") return empty;
  const s = raw as Partial<RepackageData>;
  const source = (s.source ?? {}) as Partial<RepackageSource>;
  const confidence: ConfidenceMap = {};
  if (s.confidence && typeof s.confidence === "object") {
    for (const k of CONFIDENCE_FIELD_KEYS) {
      const v = (s.confidence as ConfidenceMap)[k];
      if (typeof v === "number" && Number.isFinite(v)) confidence[k] = v;
    }
  }
  const before = s.before && typeof s.before === "object" ? (s.before as Partial<RepackageBefore>) : null;
  const extracted = normalizeExtracted(s.extracted);
  // a file started before the client was asked up front keeps the one its import carried
  const stored = (s.customer && typeof s.customer === "object" ? s.customer : null) as Partial<RepackageCustomer> | null;
  return {
    source: {
      supplier_name: str(source.supplier_name),
      supplier_id: typeof source.supplier_id === "string" ? source.supplier_id : null,
      company_supplier_id: typeof source.company_supplier_id === "string" ? source.company_supplier_id : null,
      original_file_path: typeof source.original_file_path === "string" ? source.original_file_path : null,
      pdf_kind: source.pdf_kind === "text" || source.pdf_kind === "scanned" ? source.pdf_kind : null,
      ocr_used: source.ocr_used === true,
      ocr_unavailable: source.ocr_unavailable === true,
      imported_at: typeof source.imported_at === "string" ? source.imported_at : null,
      how:
        source.how === "ai-text" || source.how === "ai-vision" || source.how === "parser" || source.how === "none"
          ? source.how
          : null,
      summary: str(source.summary),
    },
    customer: stored
      ? { customer_name: str(stored.customer_name), customer_phone: str(stored.customer_phone) }
      : { customer_name: extracted?.customer_name ?? "", customer_phone: extracted?.customer_phone ?? "" },
    extracted,
    confidence,
    reviewed: Array.isArray(s.reviewed)
      ? (s.reviewed.filter((k): k is ConfidenceFieldKey =>
          typeof k === "string" && (CONFIDENCE_FIELD_KEYS as string[]).includes(k)) as ConfidenceFieldKey[])
      : [],
    additions: normalizeAdditions(s.additions),
    final_total: numOrNull(s.final_total),
    final_currency: str(s.final_currency, empty.final_currency),
    markup_applied: s.markup_applied === true,
    before: before
      ? {
          supplier_total: numOrNull(before.supplier_total),
          supplier_currency: str(before.supplier_currency, empty.final_currency),
          includes: strArr(before.includes),
          excludes: strArr(before.excludes),
          terms: strArr(before.terms),
        }
      : null,
    produced_serial: typeof s.produced_serial === "string" ? s.produced_serial : null,
  };
}

// ---------- confidence helpers ----------
/** A field is "confident" when its score ≥ threshold OR the human reviewed it. */
export function isFieldConfident(data: RepackageData, key: ConfidenceFieldKey): boolean {
  if (data.reviewed.includes(key)) return true;
  const score = data.confidence[key];
  return typeof score === "number" && score >= CONFIDENCE_THRESHOLD;
}

/** The uncertain (low-confidence, unreviewed) fields — highlighted on /review. */
export function uncertainFields(data: RepackageData): ConfidenceFieldKey[] {
  return CONFIDENCE_FIELD_KEYS.filter((k) => data.confidence[k] !== undefined && !isFieldConfident(data, k));
}

/** Any CRITICAL field still uncertain? If false + nights invariant holds, /review auto-skips. */
export function hasUncertainCriticals(data: RepackageData): boolean {
  return CRITICAL_FIELDS.some((k) => !isFieldConfident(data, k));
}

// ---------- the client and the agent's additions ----------
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** The customer is known: a name or a phone is on the file. */
export function hasCustomer(c: RepackageCustomer): boolean {
  return Boolean(c.customer_name.trim() || c.customer_phone.trim());
}

/** The additions that print — a line with no title says nothing (validation stops a priced one). */
export function printableAdditions(data: Pick<RepackageData, "additions">): RepackageAddition[] {
  return data.additions.filter((a) => a.title.trim());
}

/** «عنوان — تفصيل», the line the client's «يشمل» list prints. */
export function additionLine(a: Pick<RepackageAddition, "title" | "detail">): string {
  const title = a.title.trim();
  const detail = a.detail.trim();
  return detail ? `${title} — ${detail}` : title;
}

/** What the priced additions add to the client's total. */
export function additionsTotal(data: Pick<RepackageData, "additions">): number {
  return round2(printableAdditions(data).reduce((sum, a) => sum + (a.sell_price ?? 0), 0));
}

/** What the client pays: the package's sell price plus the priced additions. Null until the package is priced. */
export function clientTotal(data: Pick<RepackageData, "additions" | "final_total">): number | null {
  return data.final_total == null ? null : round2(data.final_total + additionsTotal(data));
}

/** The flights the agent typed beside the supplier's — shown in the edit stage's diff. */
export function addedFlights(pkg: ExtractedPackage): ExtractedFlight[] {
  return pkg.flights.filter((f) => f.added === true);
}

// ---------- stops, stays and the trip's dates ----------
/**
 * Which stop each hotel is for. A city can be visited twice (تبليسي first and
 * last) with a different hotel each time, so a hotel names its stop by key —
 * pairing by the city's NAME gave the second visit the first visit's hotel.
 *
 * A hotel whose key still names a stop keeps it. Otherwise the n-th hotel of a
 * city goes to the n-th visit of that city (any extra one stays with its last
 * visit), and a hotel whose city is not on the list keeps the old positional
 * pairing: hotel i → stop i.
 */
export function keyHotels(cities: ExtractedCity[], hotels: ExtractedHotel[]): ExtractedHotel[] {
  const keys = cityKeys(cities);
  const known = new Set(keys);
  const seen = new Map<string, number>();
  return hotels.map((h, i) => {
    const name = h.city_name.trim();
    const nth = seen.get(name) ?? 0;
    seen.set(name, nth + 1);
    if (h.city_key && known.has(h.city_key)) return h;
    const visits = name ? keys.filter((_, ci) => cities[ci].city_name.trim() === name) : [];
    const key = visits.length > 0 ? visits[Math.min(nth, visits.length - 1)] : keys[i];
    return key ? { ...h, city_key: key } : h;
  });
}

const BOARDS: BoardType[] = ["RO", "BB", "HB", "FB", "AI"];

/** Supplier PDFs write the board in any of a dozen ways; keep only what we know. */
export function normalizeBoard(raw: string | null | undefined): BoardType | null {
  const value = (raw ?? "").trim().toUpperCase();
  if (BOARDS.includes(value as BoardType)) return value as BoardType;
  const text = (raw ?? "").trim();
  if (/إفطار|افطار|breakfast/i.test(text)) return "BB";
  if (/نصف|half/i.test(text)) return "HB";
  if (/كامل|full/i.test(text)) return "FB";
  if (/شامل|all\s*inclusive/i.test(text)) return "AI";
  if (/غرفة فقط|room only/i.test(text)) return "RO";
  return null;
}

const DAY_MS = 86_400_000;

/** ISO date + N days, in UTC so a DST change never shifts the calendar day. */
export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The nights the issued offer counts: the package's own, else its cities'. */
export function packageNights(pkg: ExtractedPackage): number {
  return pkg.trip_nights ?? pkg.cities.reduce((sum, c) => sum + (c.nights ?? 0), 0);
}

/**
 * How a visit's nights are shared by its hotels: a hotel that says its nights
 * keeps them; the ones that do not share what is left evenly, the remainder on
 * the last of them (5 nights, two hotels → 2 then 3).
 */
export function splitVisitNights(total: number, own: (number | null)[]): number[] {
  const left = Math.max(total - own.reduce<number>((sum, n) => sum + (n ?? 0), 0), 0);
  const open = own.filter((n) => n == null).length;
  const each = open > 0 ? Math.floor(left / open) : 0;
  let seen = 0;
  return own.map((n) => {
    if (n != null) return n;
    seen += 1;
    return seen === open ? left - each * (open - 1) : each;
  });
}

export type PackageStop = {
  city_name: string;
  /** the visit's own nights — its hotels' nights must add up to them (visitNightsGaps). */
  nights: number;
  /** its hotels in order, each with the nights it is booked for; `index` is its place in pkg.hotels. */
  hotels: { hotel: ExtractedHotel; index: number; nights: number }[];
};

/**
 * The package's visits in order, each with ALL its hotels (keyHotels). One
 * hotel takes the visit's nights, as it always did; two or more chain inside
 * the visit (splitVisitNights). A package read without cities is its hotels in
 * order, each its own stop.
 */
export function packageStops(pkg: ExtractedPackage): PackageStop[] {
  const cities = withCityKeys(pkg.cities);
  if (cities.length === 0) {
    return pkg.hotels.map((hotel, index) => ({ city_name: hotel.city_name, nights: hotel.nights ?? 0, hotels: [{ hotel, index, nights: hotel.nights ?? 0 }] }));
  }
  const keys = cityKeys(cities);
  const keyed = keyHotels(cities, pkg.hotels).map((hotel, index) => ({ hotel, index }));
  return cities.map((c, i) => {
    const mine = keyed.filter(({ hotel }) => hotel.city_key === keys[i]);
    if (mine.length <= 1) {
      const nights = c.nights ?? mine[0]?.hotel.nights ?? 0;
      return { city_name: c.city_name, nights, hotels: mine.map((h) => ({ ...h, nights })) };
    }
    const nights = c.nights ?? mine.reduce((sum, { hotel }) => sum + (hotel.nights ?? 0), 0);
    const split = splitVisitNights(nights, mine.map(({ hotel }) => hotel.nights));
    return { city_name: c.city_name, nights, hotels: mine.map((h, k) => ({ ...h, nights: split[k] })) };
  });
}

/** The visits whose hotels' nights do not add up to the visit's — the review asks for them to. */
export function visitNightsGaps(pkg: ExtractedPackage): { city_name: string; nights: number; sum: number }[] {
  return packageStops(pkg).flatMap((stop) => {
    if (stop.hotels.length < 2) return [];
    const sum = stop.hotels.reduce((total, h) => total + h.nights, 0);
    return sum === stop.nights ? [] : [{ city_name: stop.city_name, nights: stop.nights, sum }];
  });
}

export type PackageStay = {
  /** the visit it belongs to — its place in packageStops. */
  stop: number;
  city_name: string;
  hotel: ExtractedHotel | null;
  board_type: BoardType | null;
  nights: number;
  check_in: string | null;
  check_out: string | null;
};

/**
 * The package's stays in order — one per hotel of each visit (packageStops),
 * dates chained from the arrival date, so every stay agrees with the arrival
 * the employee entered; a visit's second hotel starts where its first ends. A
 * visit without a hotel is still a stay. The one mapping the preview AND the
 * issued offer use.
 */
export function packageStays(pkg: ExtractedPackage): PackageStay[] {
  let cursor = pkg.arrival_date;
  return packageStops(pkg).flatMap((stop, at) => {
    const start = cursor;
    const parts: { hotel: ExtractedHotel | null; nights: number }[] = stop.hotels.length > 0 ? stop.hotels : [{ hotel: null, nights: stop.nights }];
    const stays = parts.map(({ hotel, nights }) => {
      // no arrival yet: whatever dates the supplier printed
      const check_in = cursor ?? hotel?.check_in ?? null;
      const check_out = cursor ? addDaysIso(cursor, nights) : (hotel?.check_out ?? null);
      if (cursor) cursor = check_out;
      return { stop: at, city_name: stop.city_name, hotel, board_type: normalizeBoard(hotel?.board), nights, check_in, check_out };
    });
    // the next visit starts when this one's nights end, whatever its hotels add up to (the review flags a gap)
    if (start) cursor = addDaysIso(start, stop.nights);
    return stays;
  });
}

/**
 * A new arrival MOVES the trip: its length is kept (the departure follows) and
 * the supplier's flights move by the same number of days, so nothing is left on
 * the old dates. An empty departure is derived the same way.
 */
export function withArrival(pkg: ExtractedPackage, arrival: string | null): Partial<ExtractedPackage> {
  const shift = pkg.arrival_date && arrival ? daysBetween(pkg.arrival_date, arrival) : 0;
  const move = (at: string | null) => {
    const day = localDatePart(at);
    return day ? withDatePart(at, addDaysIso(day, shift)) : at;
  };
  const nights = packageNights(pkg);
  return {
    arrival_date: arrival,
    departure_date: arrival && nights > 0 ? addDaysIso(arrival, nights) : pkg.departure_date,
    flights: shift ? pkg.flights.map((f) => ({ ...f, departure_at: move(f.departure_at), arrival_at: move(f.arrival_at) })) : pkg.flights,
  };
}

/** A typed departure re-measures the nights (the generator's rule) — the cities must then add up to them. */
export function withDeparture(pkg: ExtractedPackage, departure: string | null): Partial<ExtractedPackage> {
  const nights = pkg.arrival_date && departure ? daysBetween(pkg.arrival_date, departure) : 0;
  return nights > 0 ? { departure_date: departure, trip_nights: nights } : { departure_date: departure };
}

/** The departure an import implies when the supplier did not print one: arrival + nights. */
export function impliedDeparture(pkg: ExtractedPackage): string | null {
  const nights = packageNights(pkg);
  return pkg.departure_date ?? (pkg.arrival_date && nights > 0 ? addDaysIso(pkg.arrival_date, nights) : null);
}

// ---------- one-tap common items (edit stage) ----------
export const DEFAULT_INCLUDES = [
  "الإقامة في الفنادق المذكورة",
  "الإفطار اليومي",
  "الاستقبال والتوديع بالمطار",
  "المواصلات حسب البرنامج",
  "جولات سياحية",
];
export const DEFAULT_EXCLUDES = [
  "تذاكر الطيران الدولية",
  "التأشيرة",
  "المصاريف الشخصية",
  "أي خدمة غير مذكورة في البرنامج",
];
export const DEFAULT_TERMS = [
  "الأسعار قابلة للتغيير حسب توفر الحجز وقت التأكيد.",
  "يلزم دفع عربون لتأكيد الحجز.",
  "الأسعار غير مضمونة إلا بعد التأكيد النهائي.",
];
