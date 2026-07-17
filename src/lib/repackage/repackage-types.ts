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
export type ExtractedCity = { city_name: string; nights: number | null };

export type ExtractedHotel = {
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
};

/**
 * The structured FACTS read from the supplier PDF. This is the working model:
 * it starts from extraction and is corrected (review) + edited (edit) in place.
 * Client-safe facts only — the supplier's COST lives in `supplier_total`
 * (mapped to buy_price internally, never shipped to a client).
 */
export type ExtractedPackage = {
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
  /** Storage path of the original file — internal audit only, NEVER on client output. */
  original_file_path: string | null;
  pdf_kind: "text" | "scanned" | null;
  ocr_used: boolean;
  /** true when the PDF was scanned but no OCR provider was configured. */
  ocr_unavailable: boolean;
  imported_at: string | null;
};

/** Frozen at first edit so the edit stage can render a before→after diff. */
export type RepackageBefore = {
  supplier_total: number | null;
  supplier_currency: string;
  includes: string[];
  excludes: string[];
  terms: string[];
};

export type RepackageData = {
  source: RepackageSource;
  /** the working package (null until a file is imported). */
  extracted: ExtractedPackage | null;
  /** per-field extraction confidence (0..1). */
  confidence: ConfidenceMap;
  /** field keys the human has confirmed/corrected in /review. */
  reviewed: ConfidenceFieldKey[];
  /** our client-facing SELL price (edit stage). */
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
      original_file_path: null,
      pdf_kind: null,
      ocr_used: false,
      ocr_unavailable: false,
      imported_at: null,
    },
    extracted: null,
    confidence: {},
    reviewed: [],
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
  return {
    destination: str(e.destination),
    country: str(e.country),
    cities: Array.isArray(e.cities)
      ? e.cities.map((c) => ({ city_name: str((c as ExtractedCity)?.city_name), nights: numOrNull((c as ExtractedCity)?.nights) }))
      : [],
    trip_nights: numOrNull(e.trip_nights),
    arrival_date: typeof e.arrival_date === "string" ? e.arrival_date : null,
    departure_date: typeof e.departure_date === "string" ? e.departure_date : null,
    adults: intOr(e.adults, 2),
    children: intOr(e.children, 0),
    infants: intOr(e.infants, 0),
    hotels: Array.isArray(e.hotels)
      ? e.hotels.map((h) => {
          const hh = (h ?? {}) as Partial<ExtractedHotel>;
          return {
            city_name: str(hh.city_name),
            hotel_name: str(hh.hotel_name),
            room_type: str(hh.room_type),
            board: str(hh.board),
            nights: numOrNull(hh.nights),
            check_in: typeof hh.check_in === "string" ? hh.check_in : null,
            check_out: typeof hh.check_out === "string" ? hh.check_out : null,
          };
        })
      : [],
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
  return {
    source: {
      supplier_name: str(source.supplier_name),
      supplier_id: typeof source.supplier_id === "string" ? source.supplier_id : null,
      original_file_path: typeof source.original_file_path === "string" ? source.original_file_path : null,
      pdf_kind: source.pdf_kind === "text" || source.pdf_kind === "scanned" ? source.pdf_kind : null,
      ocr_used: source.ocr_used === true,
      ocr_unavailable: source.ocr_unavailable === true,
      imported_at: typeof source.imported_at === "string" ? source.imported_at : null,
    },
    extracted: normalizeExtracted(s.extracted),
    confidence,
    reviewed: Array.isArray(s.reviewed)
      ? (s.reviewed.filter((k): k is ConfidenceFieldKey =>
          typeof k === "string" && (CONFIDENCE_FIELD_KEYS as string[]).includes(k)) as ConfidenceFieldKey[])
      : [],
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

export const CURRENCIES = ["SAR", "USD", "EUR", "TRY", "MYR", "THB", "IDR", "AED"] as const;

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
