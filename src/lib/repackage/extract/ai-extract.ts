import "server-only";
import type { ConfidenceMap, ExtractedPackage } from "../repackage-types";
import { CONFIDENCE_FIELD_KEYS } from "../repackage-types";

/**
 * AI reading of a supplier package — text OR pictures.
 *
 * WHY this exists: the regex parser only ever worked on supplier PDFs whose
 * text layer was real Arabic prose. Agencies mostly send a designed brochure —
 * a PowerPoint exported to PDF, or a WhatsApp screenshot — where every word is
 * baked into artwork. The parser then read nothing and the review screen opened
 * completely blank, which is exactly what a human would call "it didn't work".
 *
 * A vision-capable model reads both cases, so the same call handles a text
 * layer, a rendered slide, or a photo of a printout.
 *
 * WHAT IT MAY AND MAY NOT DO — this is a supplier document, so the facts must
 * come from the page, not from the model's imagination:
 *   • every field is nullable and the model is told to leave it empty rather
 *     than guess; `found` marks the ones it actually read
 *   • the price it returns is the SUPPLIER's, our cost basis. Our selling price
 *     is set by a human in the pricing stage and is never asked for here
 *   • an unfound critical field keeps confidence 0, so the review gate still
 *     stops the import exactly as it does for a bad OCR
 *
 * SERVER-ONLY: the key must never reach the browser. Read at RUNTIME via
 * bracket access so a deploy picks it up without a rebuild.
 */

const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 90_000;
/** Cap the pictures per request — cost and latency grow with each one. */
const MAX_IMAGES = 6;

function readEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function isAiExtractionConfigured(): boolean {
  return Boolean(readEnv("OPENAI_API_KEY"));
}

export type AiImage = { mime: string; base64: string };

export type AiExtractionInput = {
  /** the PDF's text layer, pasted text, or text pulled from a web page. */
  text?: string;
  /** page renders / screenshots, when the words live in artwork. */
  images?: AiImage[];
};

export type AiExtractionResult = {
  extracted: ExtractedPackage;
  confidence: ConfidenceMap;
  /** a short Arabic recap of what the document offers, shown in review. */
  summary: string;
  model: string;
};

const SYSTEM = `أنت مساعد متخصص في قراءة عروض شركات السياحة (بكجات الموردين) بالعربية والإنجليزية.
مهمتك: استخراج الحقائق المكتوبة في المستند فقط، وتلخيصه بإيجاز.

قواعد صارمة:
- لا تخترع أي معلومة. إن لم تكن مذكورة صراحةً اترك الحقل فارغاً (null أو قائمة فارغة).

- **يشمل ولا يشمل لا يُخلطان أبداً.** ابحث عن العنوانين «يشمل / البرنامج يشمل / Includes»
  و«لا يشمل / غير شامل / Excludes». كل بند يُنسب للعنوان الذي يقع تحته أو بعده مباشرة.
  البنود الشائعة في «لا يشمل»: الطيران الدولي، الغداء والعشاء، رسوم دخول الأماكن السياحية،
  التأشيرة، التأمين، ضريبة المدينة. إن رأيتها بعد «لا يشمل» فضعها في excludes لا في includes.
  وإن لم تجد عنوان «لا يشمل» فاترك excludes فارغة — لا تنقل بنوداً من includes إليها.

- **الأرقام العربية الشرقية (٠١٢٣٤٥٦٧٨٩) حوّلها إلى أرقام غربية** قبل قراءة أي عدد أو تاريخ أو سعر.
- صيغ المثنى والجمع العربية: «طفلان» = 2 أطفال، «بالغان» = 2، «ثلاثة أطفال» = 3، «ليلتان» = 2 ليلة.

- التواريخ بصيغة YYYY-MM-DD فقط، بعد تحويل الأرقام الشرقية. إن ذُكر الشهر بلا سنة فاترك التاريخ فارغاً.
- أوقات الرحلات بصيغة YYYY-MM-DDTHH:mm، وإن لم يُذكر التاريخ فاتركها فارغة.
- «الليالي» عدد صحيح. لا تحسب ما لم يُذكر أو يُستنتج من تواريخ صريحة.
- السعر المطلوب هو سعر المورّد المذكور في المستند (تكلفتنا)، لا سعر بيع مقترح.
- عملة السعر كما وردت (SAR / USD / GEL / TRY …). إن لم تُذكر فاترك supplier_currency فارغة.
- أسماء المدن والفنادق بالعربية إن وردت بالعربية، وإلا فكما وردت. انسخ الاسم حرفاً بحرف.
- transfers: التنقلات والجولات فقط. لا تضع فيها ما هو أصلاً في includes.
- terms: الشروط والملاحظات المذكورة، سطر لكل بند.
- summary: ٢-٣ جمل عربية تصف العرض (الوجهة، المدة، أبرز ما يشمله).

- **إن لم تستطع قراءة رقم أو تاريخ بوضوح تام فاتركه فارغاً.** الحقل الفارغ يُراجَع يدوياً،
  أما الرقم المخمَّن فيصل إلى العميل خطأً. ولا تخمّن سنةً غير مكتوبة في المستند.
- في found ضع اسم كل حقل قرأته فعلاً من المستند.`;

/** Mirrors ExtractedPackage so the model can only return fields we store. */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "destination", "country", "cities", "trip_nights", "arrival_date", "departure_date",
    "adults", "children", "infants", "hotels", "flights", "transfers", "includes",
    "excludes", "visas", "terms", "supplier_total", "supplier_currency", "summary", "found",
  ],
  properties: {
    destination: { type: ["string", "null"] },
    country: { type: ["string", "null"] },
    cities: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["city_name", "nights"],
        properties: { city_name: { type: "string" }, nights: { type: ["integer", "null"] } },
      },
    },
    trip_nights: { type: ["integer", "null"] },
    arrival_date: { type: ["string", "null"] },
    departure_date: { type: ["string", "null"] },
    adults: { type: ["integer", "null"] },
    children: { type: ["integer", "null"] },
    infants: { type: ["integer", "null"] },
    hotels: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["city_name", "hotel_name", "room_type", "board", "nights", "check_in", "check_out"],
        properties: {
          city_name: { type: "string" }, hotel_name: { type: "string" },
          room_type: { type: "string" }, board: { type: "string" },
          nights: { type: ["integer", "null"] },
          check_in: { type: ["string", "null"] }, check_out: { type: ["string", "null"] },
        },
      },
    },
    flights: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["airline", "flight_no", "from_airport", "to_airport", "departure_at", "arrival_at"],
        properties: {
          airline: { type: "string" }, flight_no: { type: "string" },
          from_airport: { type: "string" }, to_airport: { type: "string" },
          departure_at: { type: ["string", "null"] }, arrival_at: { type: ["string", "null"] },
        },
      },
    },
    transfers: { type: "array", items: { type: "string" } },
    includes: { type: "array", items: { type: "string" } },
    excludes: { type: "array", items: { type: "string" } },
    visas: { type: "array", items: { type: "string" } },
    terms: { type: "array", items: { type: "string" } },
    supplier_total: { type: ["number", "null"] },
    supplier_currency: { type: ["string", "null"] },
    summary: { type: "string" },
    found: {
      type: "array",
      items: {
        type: "string",
        enum: [...CONFIDENCE_FIELD_KEYS] as unknown as string[],
      },
    },
  },
} as const;

type RawResult = {
  destination: string | null; country: string | null;
  cities: { city_name: string; nights: number | null }[];
  trip_nights: number | null; arrival_date: string | null; departure_date: string | null;
  adults: number | null; children: number | null; infants: number | null;
  hotels: { city_name: string; hotel_name: string; room_type: string; board: string; nights: number | null; check_in: string | null; check_out: string | null }[];
  flights: { airline: string; flight_no: string; from_airport: string; to_airport: string; departure_at: string | null; arrival_at: string | null }[];
  transfers: string[]; includes: string[]; excludes: string[]; visas: string[]; terms: string[];
  supplier_total: number | null; supplier_currency: string | null;
  summary: string; found: string[];
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s) => s.length > 0) : [];
const int = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : fallback;
const nullableInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;
/** Only accept the shapes the document model stores; anything else is dropped. */
const isoDate = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;

/**
 * A travel date read off a picture is the easiest thing to get wrong — Eastern
 * digits in artwork misread badly, and a model asked for a date will produce a
 * plausible-looking one. A wrong date is worse than a missing one: it silently
 * reaches the client's offer, while a blank field stops at the review gate.
 *
 * So a date is kept only if it could belong to a package someone is selling
 * now: within the last year (a just-started trip) and the next three.
 */
const TRIP_DATE_PAST_DAYS = 365;
const TRIP_DATE_FUTURE_DAYS = 365 * 3;

function plausibleTripDate(value: string | null, now = Date.now()): string | null {
  if (!value) return null;
  const at = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(at)) return null;
  const days = (at - now) / 86_400_000;
  return days >= -TRIP_DATE_PAST_DAYS && days <= TRIP_DATE_FUTURE_DAYS ? value : null;
}

/** Keep a pair only when it runs forwards; a reversed pair means a misread. */
function plausibleRange(from: string | null, to: string | null, now = Date.now()): [string | null, string | null] {
  const a = plausibleTripDate(from, now);
  const b = plausibleTripDate(to, now);
  if (a && b && a > b) return [null, null];
  return [a, b];
}
const isoDateTime = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v.trim()) ? v.trim().slice(0, 16) : null;

function toPackage(raw: RawResult): ExtractedPackage {
  const [arrival, departure] = plausibleRange(isoDate(raw.arrival_date), isoDate(raw.departure_date));
  return {
    destination: str(raw.destination),
    country: str(raw.country),
    cities: (Array.isArray(raw.cities) ? raw.cities : [])
      .map((c) => ({ city_name: str(c?.city_name), nights: nullableInt(c?.nights) }))
      .filter((c) => c.city_name.length > 0),
    trip_nights: nullableInt(raw.trip_nights),
    arrival_date: arrival,
    departure_date: departure,
    adults: int(raw.adults, 2),
    children: int(raw.children, 0),
    infants: int(raw.infants, 0),
    hotels: (Array.isArray(raw.hotels) ? raw.hotels : [])
      .map((h) => ({
        city_name: str(h?.city_name),
        hotel_name: str(h?.hotel_name),
        room_type: str(h?.room_type),
        board: str(h?.board),
        nights: nullableInt(h?.nights),
        check_in: plausibleTripDate(isoDate(h?.check_in)),
        check_out: plausibleTripDate(isoDate(h?.check_out)),
      }))
      .filter((h) => h.hotel_name.length > 0 || h.city_name.length > 0),
    flights: (Array.isArray(raw.flights) ? raw.flights : [])
      .map((f) => ({
        airline: str(f?.airline),
        flight_no: str(f?.flight_no),
        from_airport: str(f?.from_airport),
        to_airport: str(f?.to_airport),
        departure_at: isoDateTime(f?.departure_at),
        arrival_at: isoDateTime(f?.arrival_at),
      }))
      .filter((f) => f.airline || f.flight_no || f.from_airport),
    transfers: list(raw.transfers),
    includes: list(raw.includes),
    excludes: list(raw.excludes),
    visas: list(raw.visas),
    terms: list(raw.terms),
    supplier_total: typeof raw.supplier_total === "number" && raw.supplier_total > 0 ? raw.supplier_total : null,
    supplier_currency: str(raw.supplier_currency) || "SAR",
  };
}

/**
 * Confidence from what the model says it READ, cross-checked against what
 * actually survived normalization — a field it claims to have found but which
 * arrived empty scores 0, so the review gate still catches it.
 */
function toConfidence(raw: RawResult, pkg: ExtractedPackage): ConfidenceMap {
  const found = new Set(list(raw.found));
  const present: Record<(typeof CONFIDENCE_FIELD_KEYS)[number], boolean> = {
    destination: pkg.destination.length > 0,
    country: pkg.country.length > 0,
    cities: pkg.cities.length > 0,
    trip_nights: pkg.trip_nights !== null,
    dates: pkg.arrival_date !== null || pkg.departure_date !== null,
    pax: true,
    hotels: pkg.hotels.length > 0,
    flights: pkg.flights.length > 0,
    includes: pkg.includes.length > 0,
    excludes: pkg.excludes.length > 0,
    supplier_total: pkg.supplier_total !== null,
    terms: pkg.terms.length > 0,
  };
  const map = {} as ConfidenceMap;
  for (const key of CONFIDENCE_FIELD_KEYS) {
    // 0.85, never 1: a read is still a machine's reading of someone else's file
    map[key] = present[key] && found.has(key) ? 0.85 : present[key] ? 0.6 : 0;
  }
  return map;
}

export async function aiExtractPackage(input: AiExtractionInput): Promise<AiExtractionResult> {
  const key = readEnv("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const model = readEnv("OPENAI_MODEL") || DEFAULT_MODEL;

  const text = (input.text ?? "").trim().slice(0, 60_000);
  const images = (input.images ?? []).slice(0, MAX_IMAGES);
  if (!text && images.length === 0) throw new Error("nothing to read");

  const content: Record<string, unknown>[] = [];
  content.push({
    type: "text",
    text: images.length
      ? "اقرأ صور عرض المورّد التالية واستخرج بيانات الباقة."
      : "اقرأ نص عرض المورّد التالي واستخرج بيانات الباقة.",
  });
  if (text) content.push({ type: "text", text });
  for (const img of images) {
    content.push({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.base64}`, detail: "high" } });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "supplier_package", strict: true, schema: SCHEMA },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const payload = json.choices?.[0]?.message?.content;
    if (!payload) throw new Error("OpenAI returned no content");
    const raw = JSON.parse(payload) as RawResult;
    const extracted = toPackage(raw);
    return { extracted, confidence: toConfidence(raw, extracted), summary: str(raw.summary), model };
  } finally {
    clearTimeout(timer);
  }
}

/** Exposed for the guard tests — not part of the module contract. */
export const __testables = { plausibleTripDate, plausibleRange };
