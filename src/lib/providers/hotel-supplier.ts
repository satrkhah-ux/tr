/**
 * Hotel supplier abstraction — the machine-to-machine (XML/API) contract used by
 * the search/select UX and the pricing engine. N-supplier ready: TBO is live
 * today; Hotelbeds/Agoda slot in as new `HotelSupplier` implementations with the
 * same shape. NO browser login, NO OTP, NO scraping — these use API credentials.
 *
 * STATIC content (name/stars/images/facilities/room catalogue) is fetched via
 * `fetchContent` and cached; LIVE rates (room+board+price+rate_key+valid_until)
 * come from `searchHotels`/`searchRates` and are NEVER cached beyond validity.
 * Room type and board type belong to the RATE, never to cached content.
 */

import "server-only";
import type { SupplierRate } from "@/lib/pricing/rate-types";
import type { BoardType } from "@/lib/types";
import {
  ALMOSAFER_DEMO_HOTELS,
  ALMOSAFER_DEMO_LABEL,
  almosaferDemoCityKey,
} from "./almosafer-demo";

export type SupplierCredentials = {
  base_url: string;
  username: string;
  password: string;
};

/** hotel_suppliers.environment — suppliers issue a different host per environment. */
export type SupplierEnvironment = "sandbox" | "live";

export type SupplierImage = { url: string; order: number; caption: string | null };

export type SupplierHotelContent = {
  supplier_hotel_id: string;
  name_ar: string;
  name_en: string | null;
  star_rating: number | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  images: SupplierImage[];
  /** the "أمور ترفيهية": pool, spa, gym, kids_club, beach, wifi, parking, … */
  facilities: string[];
  room_type_catalogue: { code: string; name_ar: string; name_en: string | null }[];
  check_in_time: string | null;
  check_out_time: string | null;
};

/** One hotel in a search result: a thumbnail + live rates for the exact stay. */
export type SupplierHotelSearchResult = {
  supplier_hotel_id: string;
  name_ar: string;
  star_rating: number | null;
  thumbnail_url: string | null;
  rates: SupplierRate[];
};

export type HotelSearchQuery = {
  city: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  rooms: number;
  /**
   * ISO-2 of the destination country. Optional for the mock adapter, but REAL
   * suppliers cannot resolve a city name on its own — TBO looks a city up
   * within a country, so a live search without this returns nothing rather
   * than guessing which "طرابلس" the agent meant.
   */
  country_code?: string | null;
  /**
   * ISO-2 nationality of the guests. Hotel net rates are nationality-dependent
   * (resident vs GCC vs other), so quoting the wrong one quotes the wrong price.
   * Defaults to SA.
   */
  nationality?: string | null;
};

export type TestConnectionResult = {
  ok: boolean;
  /** readable Arabic message; NEVER a raw supplier error or endpoint. */
  message: string;
  sampleCount?: number;
};

// ---------------------------------------------------------------------------
// Booking — the part that spends money.
// ---------------------------------------------------------------------------

/**
 * Why every booking call returns a discriminated union instead of `T | null`.
 *
 * "The supplier said no" and "we never reached the supplier" are opposite facts
 * with opposite correct responses, and the whole cost of confusing them lands on
 * one case: a `Book` that timed out. The reservation may exist. Retrying it
 * books the room twice; treating it as failed leaves a guest with no room and us
 * with a bill. So `unreachable` is its own outcome, and the caller is forced to
 * handle it — TBO's own spec says to call BookingDetail 120 seconds later rather
 * than assume anything.
 */
export type SupplierOutcome<T> =
  | { kind: "ok"; data: T }
  /** the supplier answered, and the answer was no. Safe to show and to stop on. */
  | { kind: "rejected"; code: number | null; message: string }
  /** no answer: timeout, network, non-JSON. State is UNKNOWN, never "failed". */
  | { kind: "unreachable"; message: string };

export type PrebookResult = {
  booking_code: string;
  /** the price the supplier will actually honour, for the whole stay. */
  total_fare: number;
  currency: string;
  refundable: boolean;
  cancellation_policy: string;
  /** last moment a free cancellation is possible, ISO date, if any. */
  cancellation_deadline: string | null;
  room_name: string;
};

export type BookGuest = {
  title: "Mr" | "Mrs" | "Ms";
  first_name: string;
  last_name: string;
  type: "Adult" | "Child";
};

export type BookInput = {
  booking_code: string;
  /** one entry per ROOM; each entry lists that room's guests. */
  rooms: { guests: BookGuest[] }[];
  /** our idempotency key — the unique client_reference on the booking row. */
  client_reference: string;
  /** our own reference, persisted BEFORE the call so a lost answer is findable. */
  booking_reference: string;
  total_fare: number;
  email: string;
  phone: string;
};

export type BookResult = {
  confirmation_number: string;
  client_reference: string | null;
};

export type BookingDetailResult = {
  status: string;
  confirmation_number: string | null;
  /** the HOTEL's own reference. TBO only has it when check-in is within 30 days. */
  hotel_confirmation_number: string | null;
  invoice_number: string | null;
  check_in: string | null;
  check_out: string | null;
  total_fare: number | null;
  currency: string | null;
  cancellation_policy: string | null;
  cancellation_deadline: string | null;
  voucher: boolean;
};

export interface HotelSupplier {
  readonly code: string;
  readonly name: string;
  /** real server-side auth + a sample search; returns ✅/❌ + Arabic message. */
  testConnection(): Promise<TestConnectionResult>;
  /** hotels for a city + dates + occupancy, each with LIVE rates. */
  searchHotels(query: HotelSearchQuery): Promise<SupplierHotelSearchResult[]>;
  /** re-fetch LIVE rates for ONE hotel (used to re-validate before select/confirm). */
  searchRates(query: HotelSearchQuery & { supplier_hotel_id: string }): Promise<SupplierRate[]>;
  /** STATIC content for one hotel — fetched ONCE, then cached. */
  fetchContent(supplierHotelId: string): Promise<SupplierHotelContent | null>;

  // ---- optional: only suppliers we can actually book through implement these.
  // Optional rather than throwing stubs, so `typeof s.book === "function"` is the
  // honest test of whether a machine booking is possible at all.

  /** re-validate a rate and get the price the supplier will honour NOW. */
  prebook?(bookingCode: string): Promise<SupplierOutcome<PrebookResult>>;
  /** commit. Spends money. */
  book?(input: BookInput): Promise<SupplierOutcome<BookResult>>;
  /** read a booking back — also the recovery path after a lost Book answer. */
  bookingDetail?(ref: { confirmation_number?: string; booking_reference?: string }): Promise<SupplierOutcome<BookingDetailResult>>;
  cancel?(confirmationNumber: string): Promise<SupplierOutcome<{ confirmation_number: string; message: string }>>;
}

/**
 * One line per API call, handed to whoever built the adapter.
 *
 * The provider layer does not touch the database — it hands the record out and
 * the data layer decides where it goes. That keeps every adapter testable with
 * no Supabase, and keeps the certification log a by-product of real traffic
 * rather than a second code path that can disagree with it.
 */
export type SupplierCallRecord = {
  supplier_code: string;
  method: string;
  request: unknown;
  response: unknown;
  http_status: number | null;
  status_code: number | null;
  duration_ms: number;
  ok: boolean;
};

export type SupplierCallRecorder = (record: SupplierCallRecord) => void;

// ---------------------------------------------------------------------------
// Deterministic mock data engine (shared by the mock adapter and the simulated
// TBO adapter). Stable per (city, hotel) so a re-search returns the same hotels.
// ---------------------------------------------------------------------------
const FACILITY_POOL = ["pool", "spa", "gym", "kids_club", "beach", "wifi", "parking", "restaurant"];
const HOTEL_STEMS = ["سيزونز", "ماريوت", "جراند بلازا", "بارك رويال", "نوفوتيل", "الخليج"];

function hashCode(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 1_000_003;
  return h;
}

/** A distinct, always-embeddable data-URI SVG "photo" (no network needed). */
function mockImage(seed: string, label: string): string {
  const hue = hashCode(seed) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240">` +
    `<rect width="400" height="240" fill="hsl(${hue},45%,42%)"/>` +
    `<rect y="180" width="400" height="60" fill="rgba(0,0,0,0.28)"/>` +
    `<text x="20" y="218" font-family="sans-serif" font-size="20" fill="#fff">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function nightsBetween(a: string, b: string): number {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 1;
  return Math.max(Math.round((t2 - t1) / 86_400_000), 1);
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function mockHotelIds(city: string): { id: string; name: string; stars: number }[] {
  const base = hashCode(city);
  return HOTEL_STEMS.slice(0, 4).map((stem, i) => ({
    id: `TBO-${(base + i * 7) % 100000}`,
    name: `فندق ${stem} ${city}`,
    stars: 5 - (i % 3),
  }));
}

export function mockContent(supplierHotelId: string, cityHint?: string): SupplierHotelContent {
  const seed = hashCode(supplierHotelId);
  const stars = 5 - (seed % 3);
  const name = `فندق ${HOTEL_STEMS[seed % HOTEL_STEMS.length]}${cityHint ? ` ${cityHint}` : ""}`;
  const facilities = FACILITY_POOL.filter((_, i) => (seed >> i) % 2 === 0).slice(0, 6);
  return {
    supplier_hotel_id: supplierHotelId,
    name_ar: name,
    name_en: null,
    star_rating: stars,
    address: cityHint ? `وسط ${cityHint}` : null,
    lat: null,
    lng: null,
    description: "فندق حديث بموقع مميز قرب المعالم الرئيسية ووسائل المواصلات.",
    images: [0, 1, 2].map((o) => ({ url: mockImage(`${supplierHotelId}-${o}`, name), order: o, caption: null })),
    facilities,
    room_type_catalogue: [
      { code: "STD", name_ar: "غرفة قياسية", name_en: "Standard Room" },
      { code: "DLX", name_ar: "غرفة ديلوكس", name_en: "Deluxe Room" },
      { code: "STE", name_ar: "جناح", name_en: "Suite" },
    ],
    check_in_time: "15:00",
    check_out_time: "12:00",
  };
}

/** LIVE rates for one hotel/stay — same room offered with/without breakfast at
 *  different prices, plus a non-refundable RO. Mirrors real supplier rate lists. */
export function mockRates(supplierCode: string, hotelId: string, hotelName: string, query: HotelSearchQuery): SupplierRate[] {
  const nights = nightsBetween(query.check_in, query.check_out);
  const rooms = Math.max(query.rooms, 1);
  const perNight = 60 + (hashCode(hotelId) % 40) * 3;
  const base = perNight * nights * rooms;
  const occ = { adults: query.adults, children: query.children, rooms };
  const mk = (
    key: string,
    room: string,
    board: SupplierRate["board_type"],
    refundable: boolean,
    factor: number,
    cancellation: string,
    ref_sell: number | null,
  ): SupplierRate => ({
    supplier_id: supplierCode,
    supplier_name: supplierCode === "tbo" ? "TBO Holidays" : supplierCode,
    rate_key: `${hotelId}-${key}`,
    hotel_id: hotelId,
    hotel_name: hotelName,
    check_in: query.check_in,
    check_out: query.check_out,
    occupancy: occ,
    room_category_raw: room,
    board_type: board,
    refundable,
    cancellation_policy: cancellation,
    inclusive: round2(base * factor),
    currency: "USD",
    surcharges: [
      { name: "ضريبة الخدمة", amount: round2(base * 0.05), currency: "USD", charge: "Mandatory" },
      ...(board === "BB"
        ? [{ name: "رسوم المنتجع (تُدفع بالفندق)", amount: 15 * nights, currency: "USD", charge: "Excluded" as const }]
        : []),
    ],
    ref_sell,
    valid_until: query.check_in,
  });
  return [
    mk("BB", "Deluxe Room", "BB", true, 1.12, "إلغاء مجاني حتى 48 ساعة قبل الوصول.", round2(base * 1.12 * 1.05)),
    mk("HB", "Deluxe Room", "HB", true, 1.32, "إلغاء مجاني حتى 72 ساعة قبل الوصول.", null),
    mk("RO", "Standard Room", "RO", false, 0.92, "غير قابل للاسترداد — لا يمكن الإلغاء أو التعديل.", null),
  ];
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------
class MockHotelSupplier implements HotelSupplier {
  readonly code = "mock";
  readonly name = "مزوّد تجريبي (Mock)";
  async testConnection(): Promise<TestConnectionResult> {
    return { ok: true, message: "المزوّد التجريبي يعمل دائمًا.", sampleCount: 4 };
  }
  async searchHotels(query: HotelSearchQuery): Promise<SupplierHotelSearchResult[]> {
    return mockHotelIds(query.city).map((h) => ({
      supplier_hotel_id: h.id,
      name_ar: h.name,
      star_rating: h.stars,
      thumbnail_url: mockImage(`${h.id}-thumb`, h.name),
      rates: mockRates("mock", h.id, h.name, query),
    }));
  }
  async searchRates(query: HotelSearchQuery & { supplier_hotel_id: string }): Promise<SupplierRate[]> {
    const name = mockContent(query.supplier_hotel_id, query.city).name_ar;
    return mockRates("mock", query.supplier_hotel_id, name, query);
  }
  async fetchContent(supplierHotelId: string): Promise<SupplierHotelContent | null> {
    return mockContent(supplierHotelId);
  }
}

/** TBO Holidays HotelAPI — HTTP Basic, JSON. Verified reachable 2026-07-21. */
const TBO_DEFAULT_BASE = "https://api.tbotechnology.in/TBOHolidays_HotelAPI";

/** TBO wraps every response in {"Status":{"Code":n,"Description":"…"}}. */
type TboStatus = { Status?: { Code?: number; Description?: string } };

/**
 * TBO's status codes (spec §5), and what each one means for us.
 *
 * **Only 200 is success.** The previous implementation also accepted 201, which
 * is `NO_AVAILABILITY` — so "there are no rooms" was being read as "here are
 * your rooms", and the empty result that followed looked like a parsing problem
 * rather than the supplier's answer.
 *
 * `500` is deliberately NOT a rejection. TBO calls it "any undefined error" and
 * asks for the logs; after a Book that is indistinguishable from a reservation
 * that may exist, and the only safe reading of "may exist" is: go and look.
 */
const TBO_UNKNOWN_CODES = new Set([500]);

function tboMessage(code: number | null, description: string | undefined): string {
  switch (code) {
    case 201:
    case 207:
      return "لم تعد هذه الغرفة/السعر متاحة لدى المورّد.";
    case 315:
      return "انتهت صلاحية السعر (انقضت الجلسة) — أعد التحقق من السعر ثم احجز.";
    case 300:
      return "رصيد الشركة لدى المورّد لا يكفي لهذا الحجز.";
    case 405:
      return "رفض المورّد إنشاء الحجز.";
    case 479:
      return "تعذّر إلغاء الحجز لدى المورّد.";
    case 401:
      return "بيانات الاعتماد غير صحيحة أو الحساب غير مُفعّل لدى المورّد.";
    case 400:
      return "طلب غير صالح — راجع بيانات الحجز.";
    case 429:
      return "ضغط على واجهة المورّد — أعد المحاولة بعد قليل.";
    default:
      return description?.trim() || `رفض المورّد الطلب${code == null ? "" : ` (${code})`}.`;
  }
}

/**
 * TBO Holidays adapter — REAL calls against the live HotelAPI.
 *
 * ⚠️ THIS ADAPTER NEVER INVENTS DATA. An earlier version fell back to the mock
 * engine whenever a live call was not configured, which meant a correctly
 * configured account could show an agent fabricated hotels at fabricated prices
 * — quotable to a real customer. A supplier adapter that cannot reach its
 * supplier must return NOTHING and say why; only the explicitly-selected
 * MockHotelSupplier is allowed to invent, and that is chosen by supplier code,
 * never reached by accident.
 *
 * Rates are supplier NET. Nothing here is client-facing: the markup engine and
 * the DTO layer decide what a customer ever sees.
 */
/**
 * Per-method timeouts, from §3 of the spec — not one number for everything.
 *
 * This mattered more than it looks. The adapter used a flat 25s, and the spec
 * allows Book **120 seconds**. A hotel booking that takes 40s is ordinary; with
 * the old number we would have aborted from our side while TBO went on to
 * confirm it, producing exactly the one state this integration must never
 * produce — a real reservation the system believes failed.
 */
const TBO_TIMEOUT_MS: Record<string, number> = {
  Search: 25_000,
  search: 25_000,
  PreBook: 25_000,
  Book: 120_000,
  BookingDetail: 30_000,
  Cancel: 60_000,
};
const TBO_DEFAULT_TIMEOUT_MS = 25_000;

class TboHotelSupplier implements HotelSupplier {
  readonly code = "tbo";
  readonly name = "TBO Holidays";
  private readonly creds: SupplierCredentials | null;
  private readonly baseUrl: string;
  /** true when the row says 'sandbox' but no sandbox host was ever entered. */
  private readonly unsafeSandbox: boolean;
  private readonly record: SupplierCallRecorder | null;

  constructor(
    creds: SupplierCredentials | null,
    baseUrl: string | null,
    environment: SupplierEnvironment = "live",
    record: SupplierCallRecorder | null = null,
  ) {
    this.creds = creds;
    this.record = record;
    const stored = baseUrl?.trim() || "";
    // A stored base URL wins (TBO issues per-account hosts), else the public one.
    this.baseUrl = (stored || TBO_DEFAULT_BASE).replace(/\/+$/, "");
    // TBO issues a SEPARATE host for testing. Falling back to the built-in
    // production host while the row is marked 'sandbox' would send what an admin
    // believes are test calls to the live account — burning quota and, once
    // booking exists, touching real inventory. Fail closed instead of guessing a
    // sandbox hostname we were never given.
    this.unsafeSandbox = environment === "sandbox" && stored === "";
  }

  private ready(): boolean {
    return !this.unsafeSandbox && Boolean(this.creds?.username && this.creds?.password);
  }

  private authHeader(): string {
    const raw = `${this.creds?.username ?? ""}:${this.creds?.password ?? ""}`;
    return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
  }

  /**
   * One TBO call, with the outcome kept intact.
   *
   * TBO answers HTTP 200 while putting the real verdict in `Status.Code` — a 401
   * for bad credentials arrives inside a "successful" response. Reading only the
   * HTTP status reports success for every authentication failure, so both are
   * checked and both are recorded.
   */
  private async raw<T extends TboStatus>(path: string, body?: unknown): Promise<SupplierOutcome<T>> {
    const url = `${this.baseUrl}/${path}`;
    const started = Date.now();
    const emit = (r: Omit<SupplierCallRecord, "supplier_code" | "method" | "request" | "duration_ms">) => {
      this.record?.({
        supplier_code: this.code,
        method: path,
        request: body ?? null,
        duration_ms: Date.now() - started,
        ...r,
      });
    };

    try {
      const res = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: this.authHeader(),
          "content-type": "application/json",
          accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TBO_TIMEOUT_MS[path] ?? TBO_DEFAULT_TIMEOUT_MS),
        cache: "no-store",
      });
      const text = await res.text();
      let json: T | null = null;
      try {
        json = JSON.parse(text) as T;
      } catch {
        /* non-JSON body — handled below */
      }
      const code = json?.Status?.Code ?? null;
      const ok = res.ok && (typeof code !== "number" || code === 200);
      emit({ response: json ?? text.slice(0, 4000), http_status: res.status, status_code: code, ok });

      if (json === null) {
        // A body we cannot parse is not a decision — we do not know what happened.
        return { kind: "unreachable", message: `رد غير مفهوم من المورّد (${res.status})` };
      }
      if (!ok) {
        // SERVER LOG ONLY, and deliberately never the Authorization header or
        // the credentials: without this line a failure is undiagnosable — you
        // cannot tell a wrong password from a wrong path from a dead network.
        console.warn(`[tbo] ${path} rejected — http=${res.status} bodyCode=${code ?? "none"} desc=${json?.Status?.Description ?? ""}`);
        if (code != null && TBO_UNKNOWN_CODES.has(code)) {
          return { kind: "unreachable", message: "خطأ غير محدّد لدى المورّد — تحقق من الحالة قبل أي إعادة." };
        }
        return { kind: "rejected", code, message: tboMessage(code, json?.Status?.Description) };
      }
      return { kind: "ok", data: json };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ response: { error: message }, http_status: null, status_code: null, ok: false });
      console.warn(`[tbo] ${path} threw — ${message}`);
      return { kind: "unreachable", message: "تعذّر الوصول إلى المورّد" };
    }
  }

  /**
   * The read-only shorthand: null on any failure.
   *
   * Correct for search and content, where "no answer" and "no results" lead to
   * the same screen. Booking must NOT use this — see `raw`.
   */
  private async call<T extends TboStatus>(path: string, body?: unknown): Promise<T | null> {
    const out = await this.raw<T>(path, body);
    return out.kind === "ok" ? out.data : null;
  }

  async testConnection(): Promise<TestConnectionResult> {
    if (this.unsafeSandbox) {
      return {
        ok: false,
        message:
          "البيئة مضبوطة على «تجريبي» بلا رابط خدمة — الصق رابط البيئة التجريبية الذي زوّدك به TBO في حقل «رابط الخدمة»، أو بدّل البيئة إلى «مباشر».",
      };
    }
    if (!this.ready()) {
      return { ok: false, message: "بيانات الاعتماد غير مكتملة — أدخل اسم المستخدم وكلمة المرور." };
    }
    // CountryList is the cheapest authenticated endpoint: it proves the
    // credentials work without booking anything or costing a search quota.
    const data = await this.call<TboStatus & { CountryList?: unknown[] }>("CountryList");
    if (!data) {
      return { ok: false, message: "تعذّر الاتصال بـTBO — تأكد من اسم المستخدم وكلمة المرور وصلاحية الحساب." };
    }
    const count = Array.isArray(data.CountryList) ? data.CountryList.length : 0;
    return { ok: true, message: "تم الاتصال بـTBO والمصادقة بنجاح.", sampleCount: count };
  }

  /** City name -> TBO city code, via the country the city belongs to. */
  private async resolveCityCode(city: string, countryCode: string): Promise<string | null> {
    const data = await this.call<TboStatus & { CityList?: { Code?: string; Name?: string }[] }>(
      "CityList",
      { CountryCode: countryCode },
    );
    if (!data?.CityList) return null;
    const wanted = city.trim().toLowerCase();
    const hit =
      data.CityList.find((c) => (c.Name ?? "").trim().toLowerCase() === wanted) ??
      data.CityList.find((c) => (c.Name ?? "").trim().toLowerCase().includes(wanted));
    return hit?.Code ?? null;
  }

  async searchHotels(query: HotelSearchQuery): Promise<SupplierHotelSearchResult[]> {
    if (!this.ready()) return [];

    const countryCode = (query.country_code ?? "").trim().toUpperCase();
    if (!countryCode) return [];

    const cityCode = await this.resolveCityCode(query.city, countryCode);
    if (!cityCode) return [];

    // Hotel codes for the city. This list is large and static — the caller
    // caches it (hotel_content_cache) so this runs once per city, not per search.
    const codes = await this.call<TboStatus & { Hotels?: { HotelCode?: string }[] }>(
      "TBOHotelCodeList",
      { CityCode: cityCode, IsDetailedResponse: "false" },
    );
    const hotelCodes = (codes?.Hotels ?? [])
      .map((h) => h.HotelCode)
      .filter((c): c is string => Boolean(c))
      .slice(0, 200); // TBO caps the codes per availability call
    if (hotelCodes.length === 0) return [];

    const avail = await this.call<TboStatus & { HotelResult?: TboHotelResult[] }>("search", {
      CheckIn: query.check_in,
      CheckOut: query.check_out,
      HotelCodes: hotelCodes.join(","),
      GuestNationality: query.nationality ?? "SA",
      PaxRooms: Array.from({ length: Math.max(1, query.rooms) }, () => ({
        Adults: Math.max(1, query.adults),
        Children: Math.max(0, query.children),
        ChildrenAges: [],
      })),
      ResponseTime: 23,
      IsDetailedResponse: true,
      Filters: { Refundable: false, NoOfRooms: 0, MealType: "All" },
    });

    return (avail?.HotelResult ?? [])
      .map((h) => toSearchResult(h, query))
      .filter((r): r is SupplierHotelSearchResult => r !== null);
  }

  async searchRates(query: HotelSearchQuery & { supplier_hotel_id: string }): Promise<SupplierRate[]> {
    if (!this.ready()) return [];
    const avail = await this.call<TboStatus & { HotelResult?: TboHotelResult[] }>("search", {
      CheckIn: query.check_in,
      CheckOut: query.check_out,
      HotelCodes: query.supplier_hotel_id,
      GuestNationality: query.nationality ?? "SA",
      PaxRooms: Array.from({ length: Math.max(1, query.rooms) }, () => ({
        Adults: Math.max(1, query.adults),
        Children: Math.max(0, query.children),
        ChildrenAges: [],
      })),
      ResponseTime: 23,
      IsDetailedResponse: true,
    });
    const first = (avail?.HotelResult ?? [])[0];
    return first ? toRates(first, query) : [];
  }

  async fetchContent(supplierHotelId: string): Promise<SupplierHotelContent | null> {
    if (!this.ready()) return null;
    const data = await this.call<TboStatus & { HotelDetails?: TboHotelDetail[] }>("Hoteldetails", {
      Hotelcodes: supplierHotelId,
      Language: "EN",
    });
    const d = (data?.HotelDetails ?? [])[0];
    if (!d) return null;
    return {
      supplier_hotel_id: supplierHotelId,
      name_ar: d.HotelName ?? supplierHotelId,
      name_en: d.HotelName ?? null,
      address: d.Address ?? null,
      star_rating: numOrNull(d.HotelRating),
      description: d.Description ?? null,
      facilities: Array.isArray(d.HotelFacilities)
        ? d.HotelFacilities.filter((f): f is string => typeof f === "string")
        : [],
      images: (Array.isArray(d.Images) ? d.Images : [])
        .filter((u): u is string => typeof u === "string")
        .map((url, order) => ({ url, order, caption: null })),
      lat: numOrNull(d.Latitude),
      lng: numOrNull(d.Longitude),
      // TBO returns room types only inside an availability response, not in
      // Hoteldetails — left empty rather than invented.
      room_type_catalogue: [],
      check_in_time: null,
      check_out_time: null,
    };
  }

  // -------------------------------------------------------------- booking ----

  private notReady(): SupplierOutcome<never> | null {
    if (this.unsafeSandbox) {
      return { kind: "rejected", code: null, message: "البيئة «تجريبي» بلا رابط خدمة — لا يمكن الحجز." };
    }
    if (!this.ready()) {
      return { kind: "rejected", code: null, message: "بيانات اعتماد المورّد غير مكتملة." };
    }
    return null;
  }

  /**
   * Re-validate the rate. ALWAYS immediately before booking.
   *
   * A BookingCode carries a session token and a price that were true when the
   * search ran. Between the agent quoting and the manager approving, the room
   * can be gone or dearer, and the only honest way to know is to ask again.
   */
  async prebook(bookingCode: string): Promise<SupplierOutcome<PrebookResult>> {
    const blocked = this.notReady();
    if (blocked) return blocked;

    const out = await this.raw<TboStatus & { HotelResult?: TboHotelResult[] }>("PreBook", {
      BookingCode: bookingCode,
      PaymentMode: "Limit",
    });
    if (out.kind !== "ok") return out;

    const hotel = (out.data.HotelResult ?? [])[0];
    const room = (hotel?.Rooms ?? [])[0];
    if (!hotel || !room || typeof room.TotalFare !== "number") {
      // A 200 with no room is the supplier's way of saying "gone". It is a
      // decision, not a network problem — the caller must stop, not retry.
      return { kind: "rejected", code: out.data.Status?.Code ?? null, message: "لم يعد هذا السعر متاحاً لدى المورّد." };
    }

    const policy = (room.CancelPolicies ?? [])[0];
    return {
      kind: "ok",
      data: {
        // TBO re-issues the code on PreBook; Book must use THIS one, not the
        // search's, or it books against a stale session.
        booking_code: room.BookingCode ?? bookingCode,
        total_fare: Number(room.TotalFare.toFixed(2)),
        currency: hotel.Currency ?? "USD",
        refundable: room.IsRefundable === true,
        cancellation_policy: policy?.FromDate ? `إلغاء مجاني حتى ${policy.FromDate}` : "غير قابل للإلغاء",
        cancellation_deadline: policy?.FromDate ? policy.FromDate.slice(0, 10) : null,
        room_name: (room.Name ?? []).join(" + ") || "Room",
      },
    };
  }

  async book(input: BookInput): Promise<SupplierOutcome<BookResult>> {
    const blocked = this.notReady();
    if (blocked) return blocked;

    const out = await this.raw<TboStatus & { ConfirmationNumber?: string; ClientReferenceId?: string }>("Book", {
      BookingCode: input.booking_code,
      CustomerDetails: input.rooms.map((room) => ({
        CustomerNames: room.guests.map((g) => ({
          Title: g.title,
          FirstName: g.first_name,
          LastName: g.last_name,
          Type: g.type,
        })),
      })),
      ClientReferenceId: input.client_reference,
      BookingReferenceId: input.booking_reference,
      TotalFare: input.total_fare,
      EmailId: input.email,
      PhoneNumber: input.phone,
      BookingType: "Voucher",
      // Limit only. Card fields exist in the spec and are deliberately never
      // sent: this system holds no card data, so there is none to leak.
      PaymentMode: "Limit",
    });
    if (out.kind !== "ok") return out;

    const confirmation = out.data.ConfirmationNumber?.trim();
    if (!confirmation) {
      // Success with no confirmation number is not success. Treat it as unknown
      // and let the caller recover through BookingDetail — never as "failed",
      // which would invite a second booking.
      return { kind: "unreachable", message: "وافق المورّد بلا رقم تأكيد — تحقق من الحالة قبل أي إعادة محاولة." };
    }
    return { kind: "ok", data: { confirmation_number: confirmation, client_reference: out.data.ClientReferenceId ?? null } };
  }

  async bookingDetail(ref: { confirmation_number?: string; booking_reference?: string }): Promise<SupplierOutcome<BookingDetailResult>> {
    const blocked = this.notReady();
    if (blocked) return blocked;
    if (!ref.confirmation_number && !ref.booking_reference) {
      return { kind: "rejected", code: null, message: "لا رقم تأكيد ولا مرجع حجز." };
    }

    const out = await this.raw<TboStatus & { BookingDetail?: TboBookingDetail }>("BookingDetail", {
      ...(ref.confirmation_number ? { ConfirmationNumber: ref.confirmation_number } : {}),
      ...(ref.booking_reference ? { BookingReferenceId: ref.booking_reference } : {}),
      PaymentMode: "Limit",
    });
    if (out.kind !== "ok") return out;

    const d = out.data.BookingDetail;
    if (!d) return { kind: "rejected", code: out.data.Status?.Code ?? null, message: "لا يوجد حجز بهذا المرجع لدى المورّد." };

    const room = (d.Rooms ?? [])[0];
    const policy = (room?.CancelPolicies ?? [])[0];
    return {
      kind: "ok",
      data: {
        status: d.BookingStatus ?? "",
        confirmation_number: d.ConfirmationNumber ?? null,
        // Only present when check-in is within 30 days — absence is normal, not
        // an error, and must not be shown as a missing confirmation.
        hotel_confirmation_number: d.HotelConfirmationNumber ?? null,
        invoice_number: d.InvoiceNumber ?? null,
        check_in: d.CheckIn ?? null,
        check_out: d.CheckOut ?? null,
        total_fare: typeof room?.TotalFare === "number" ? room.TotalFare : null,
        currency: d.Rooms?.[0]?.Currency ?? null,
        cancellation_policy: policy?.FromDate ? `إلغاء مجاني حتى ${policy.FromDate}` : null,
        cancellation_deadline: policy?.FromDate ? policy.FromDate.slice(0, 10) : null,
        voucher: String(d.VoucherStatus ?? "").toLowerCase() === "voucher" || d.VoucherStatus === true,
      },
    };
  }

  async cancel(confirmationNumber: string): Promise<SupplierOutcome<{ confirmation_number: string; message: string }>> {
    const blocked = this.notReady();
    if (blocked) return blocked;

    const out = await this.raw<TboStatus & { ConfirmationNumber?: string }>("Cancel", {
      ConfirmationNumber: confirmationNumber,
    });
    if (out.kind !== "ok") return out;
    return {
      kind: "ok",
      data: {
        confirmation_number: out.data.ConfirmationNumber ?? confirmationNumber,
        message: out.data.Status?.Description ?? "Cancelled",
      },
    };
  }
}

// ---------- TBO response shapes (only the fields we consume) ----------

type TboRoom = {
  Name?: string[];
  BookingCode?: string;
  Inclusion?: string;
  TotalFare?: number;
  TotalTax?: number;
  RoomPromotion?: string[];
  CancelPolicies?: { FromDate?: string; CancellationCharge?: number }[];
  MealType?: string;
  IsRefundable?: boolean;
};

type TboHotelResult = {
  HotelCode?: string;
  HotelName?: string;
  Currency?: string;
  Rooms?: TboRoom[];
};

type TboBookingDetail = {
  BookingStatus?: string;
  VoucherStatus?: string | boolean;
  ConfirmationNumber?: string;
  HotelConfirmationNumber?: string;
  InvoiceNumber?: string;
  CheckIn?: string;
  CheckOut?: string;
  BookingDate?: string;
  NoOfRooms?: number;
  Rooms?: (TboRoom & { Currency?: string })[];
};

type TboHotelDetail = {
  HotelName?: string;
  Address?: string;
  CityName?: string;
  HotelRating?: number | string;
  Description?: string;
  HotelFacilities?: unknown[];
  Images?: unknown[];
  Latitude?: number | string;
  Longitude?: number | string;
};

function numOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * TBO writes board as free text ("Room Only", "Breakfast", "Half Board", …).
 * Anything unrecognised falls back to RO — the LEAST generous reading, so an
 * unknown label can never silently promise a customer meals we did not buy.
 */
function toBoardType(raw: string | undefined): BoardType {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("all inclusive") || s.includes("all-inclusive")) return "AI";
  if (s.includes("full board")) return "FB";
  if (s.includes("half board")) return "HB";
  if (s.includes("breakfast")) return "BB";
  return "RO";
}

/** TBO room -> our SupplierRate. TotalFare is the NET fare for the whole stay. */
function toRates(hotel: TboHotelResult, query: HotelSearchQuery): SupplierRate[] {
  const currency = hotel.Currency ?? "USD";
  const occupancy = {
    adults: Math.max(1, query.adults),
    children: Math.max(0, query.children),
    rooms: Math.max(1, query.rooms),
  };
  return (hotel.Rooms ?? [])
    .filter((r) => typeof r.TotalFare === "number")
    .map((r): SupplierRate => {
      const policy = (r.CancelPolicies ?? [])[0];
      return {
        supplier_id: "tbo",
        supplier_name: "TBO Holidays",
        rate_key: r.BookingCode ?? "",
        hotel_id: hotel.HotelCode ?? "",
        hotel_name: hotel.HotelName ?? hotel.HotelCode ?? "",
        check_in: query.check_in,
        check_out: query.check_out,
        occupancy,
        room_category_raw: (r.Name ?? []).join(" + ") || "Room",
        board_type: toBoardType(r.MealType ?? r.Inclusion),
        // absent means non-refundable: the safer assumption to quote against.
        refundable: r.IsRefundable === true,
        cancellation_policy: policy?.FromDate
          ? `إلغاء مجاني حتى ${policy.FromDate}`
          : "غير قابل للإلغاء",
        inclusive: Number((r.TotalFare as number).toFixed(2)),
        currency,
        // TBO folds taxes into TotalFare and returns no separate line items.
        surcharges: [],
        ref_sell: null,
        valid_until: null,
      };
    });
}

function toSearchResult(hotel: TboHotelResult, query: HotelSearchQuery): SupplierHotelSearchResult | null {
  if (!hotel.HotelCode) return null;
  const rates = toRates(hotel, query);
  if (rates.length === 0) return null;
  return {
    supplier_hotel_id: hotel.HotelCode,
    name_ar: hotel.HotelName ?? hotel.HotelCode,
    star_rating: null,
    thumbnail_url: null,
    rates,
  };
}

/** Hotelbeds APItude. Sandbox verified reachable 2026-07-21 (403 on a bad key). */
const HOTELBEDS_DEFAULT_BASE = "https://api.test.hotelbeds.com";

/**
 * Hotelbeds (APItude) adapter.
 *
 * Exists because Hotelbeds is the one major bed-bank with INSTANT self-service
 * test credentials — so a live end-to-end search can be proven today instead of
 * waiting on a supplier's sales desk. Same contract as TBO, so switching is a
 * one-line change in the supplier registry.
 *
 * Auth is not Basic: every request carries `Api-key` plus `X-Signature`, the
 * SHA-256 of (apiKey + secret + unix-seconds). The signature is time-bound, so
 * it must be recomputed per request and never cached.
 *
 * Like TBO, this adapter NEVER invents data — an unreachable supplier returns
 * nothing and logs why.
 */
class HotelbedsHotelSupplier implements HotelSupplier {
  readonly code = "hotelbeds";
  readonly name = "Hotelbeds";
  private readonly creds: SupplierCredentials | null;
  private readonly baseUrl: string;

  constructor(creds: SupplierCredentials | null, baseUrl: string | null) {
    this.creds = creds;
    this.baseUrl = (baseUrl?.trim() || HOTELBEDS_DEFAULT_BASE).replace(/\/+$/, "");
  }

  private ready(): boolean {
    return Boolean(this.creds?.username && this.creds?.password);
  }

  /** apiKey = username field, secret = password field (the admin form is generic). */
  private async headers(): Promise<Record<string, string>> {
    const apiKey = this.creds?.username ?? "";
    const secret = this.creds?.password ?? "";
    const stamp = Math.floor(Date.now() / 1000).toString();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${apiKey}${secret}${stamp}`),
    );
    const signature = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { "Api-key": apiKey, "X-Signature": signature, accept: "application/json" };
  }

  private async call<T>(path: string, body?: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(await this.headers()),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
        cache: "no-store",
      });
      const text = await res.text();
      if (!res.ok) {
        // Server log only — never the key or the signature.
        console.warn(`[hotelbeds] ${path} failed — http=${res.status} body=${text.slice(0, 200)}`);
        return null;
      }
      return JSON.parse(text) as T;
    } catch (err) {
      console.warn(`[hotelbeds] ${path} threw — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.ready()) {
      return { ok: false, message: "بيانات الاعتماد غير مكتملة — أدخل مفتاح API والسر." };
    }
    const data = await this.call<{ status?: string }>("/hotel-api/1.0/status");
    if (!data) {
      return { ok: false, message: "تعذّر الاتصال بـHotelbeds — تأكد من مفتاح API والسر وصلاحية الحساب." };
    }
    return { ok: true, message: `تم الاتصال بـHotelbeds بنجاح (${data.status ?? "OK"}).` };
  }

  /** City name -> Hotelbeds destination code (e.g. "برشلونة"/"Barcelona" -> BCN). */
  private async resolveDestination(city: string): Promise<string | null> {
    const data = await this.call<{ destinations?: { code?: string; name?: { content?: string } }[] }>(
      "/hotel-content-api/1.0/locations/destinations?fields=all&language=ENG&from=1&to=1000",
    );
    if (!data?.destinations) return null;
    const wanted = city.trim().toLowerCase();
    const hit =
      data.destinations.find((d) => (d.name?.content ?? "").trim().toLowerCase() === wanted) ??
      data.destinations.find((d) => (d.name?.content ?? "").trim().toLowerCase().includes(wanted));
    return hit?.code ?? null;
  }

  async searchHotels(query: HotelSearchQuery): Promise<SupplierHotelSearchResult[]> {
    if (!this.ready()) return [];
    const destination = await this.resolveDestination(query.city);
    if (!destination) return [];

    const data = await this.call<{ hotels?: { hotels?: HbHotel[] } }>("/hotel-api/1.0/hotels", {
      stay: { checkIn: query.check_in, checkOut: query.check_out },
      occupancies: [
        {
          rooms: Math.max(1, query.rooms),
          adults: Math.max(1, query.adults),
          children: Math.max(0, query.children),
        },
      ],
      destination: { code: destination },
    });

    return (data?.hotels?.hotels ?? [])
      .map((h) => hbToSearchResult(h, query))
      .filter((r): r is SupplierHotelSearchResult => r !== null);
  }

  async searchRates(query: HotelSearchQuery & { supplier_hotel_id: string }): Promise<SupplierRate[]> {
    if (!this.ready()) return [];
    const data = await this.call<{ hotels?: { hotels?: HbHotel[] } }>("/hotel-api/1.0/hotels", {
      stay: { checkIn: query.check_in, checkOut: query.check_out },
      occupancies: [
        {
          rooms: Math.max(1, query.rooms),
          adults: Math.max(1, query.adults),
          children: Math.max(0, query.children),
        },
      ],
      hotels: { hotel: [Number(query.supplier_hotel_id)].filter(Number.isFinite) },
    });
    const first = (data?.hotels?.hotels ?? [])[0];
    return first ? hbToRates(first, query) : [];
  }

  async fetchContent(supplierHotelId: string): Promise<SupplierHotelContent | null> {
    if (!this.ready()) return null;
    const data = await this.call<{ hotel?: HbHotelDetail }>(
      `/hotel-content-api/1.0/hotels/${encodeURIComponent(supplierHotelId)}/details?language=ENG`,
    );
    const h = data?.hotel;
    if (!h) return null;
    return {
      supplier_hotel_id: supplierHotelId,
      name_ar: h.name?.content ?? supplierHotelId,
      name_en: h.name?.content ?? null,
      address: h.address?.content ?? null,
      star_rating: hbStars(h.categoryCode),
      description: h.description?.content ?? null,
      facilities: (h.facilities ?? [])
        .map((f) => f.description?.content)
        .filter((s): s is string => Boolean(s)),
      images: (h.images ?? [])
        .map((im) => im.path)
        .filter((p): p is string => Boolean(p))
        .map((p, order) => ({ url: `https://photos.hotelbeds.com/giata/${p}`, order, caption: null })),
      lat: numOrNull(h.coordinates?.latitude),
      lng: numOrNull(h.coordinates?.longitude),
      room_type_catalogue: [],
      check_in_time: null,
      check_out_time: null,
    };
  }
}

// ---------- Hotelbeds response shapes (only what we consume) ----------

type HbRate = {
  rateKey?: string;
  net?: string | number;
  boardName?: string;
  rateClass?: string;
  cancellationPolicies?: { from?: string }[];
};
type HbRoom = { code?: string; name?: string; rates?: HbRate[] };
type HbHotel = {
  code?: number | string;
  name?: string;
  categoryCode?: string;
  currency?: string;
  rooms?: HbRoom[];
};
type HbHotelDetail = {
  name?: { content?: string };
  address?: { content?: string };
  description?: { content?: string };
  categoryCode?: string;
  facilities?: { description?: { content?: string } }[];
  images?: { path?: string }[];
  coordinates?: { latitude?: number | string; longitude?: number | string };
};

/** "4EST" / "5EST" -> 4 / 5. Non-star categories (hostels, apartments) -> null. */
function hbStars(categoryCode: string | undefined): number | null {
  const m = (categoryCode ?? "").match(/^(\d)EST/);
  return m ? Number(m[1]) : null;
}

function hbToRates(hotel: HbHotel, query: HotelSearchQuery): SupplierRate[] {
  const currency = hotel.currency ?? "EUR";
  const occupancy = {
    adults: Math.max(1, query.adults),
    children: Math.max(0, query.children),
    rooms: Math.max(1, query.rooms),
  };
  const out: SupplierRate[] = [];
  for (const room of hotel.rooms ?? []) {
    for (const rate of room.rates ?? []) {
      const net = numOrNull(rate.net);
      if (net === null) continue;
      const deadline = (rate.cancellationPolicies ?? [])[0]?.from ?? null;
      out.push({
        supplier_id: "hotelbeds",
        supplier_name: "Hotelbeds",
        rate_key: rate.rateKey ?? "",
        hotel_id: String(hotel.code ?? ""),
        hotel_name: hotel.name ?? String(hotel.code ?? ""),
        check_in: query.check_in,
        check_out: query.check_out,
        occupancy,
        room_category_raw: room.name ?? room.code ?? "Room",
        board_type: toBoardType(rate.boardName),
        // NOR = normal (refundable); NRF = non-refundable. Unknown -> not refundable.
        refundable: rate.rateClass === "NOR",
        cancellation_policy: deadline ? `إلغاء مجاني حتى ${deadline}` : "غير قابل للإلغاء",
        inclusive: Number(net.toFixed(2)),
        currency,
        surcharges: [],
        ref_sell: null,
        valid_until: null,
      });
    }
  }
  return out;
}

function hbToSearchResult(hotel: HbHotel, query: HotelSearchQuery): SupplierHotelSearchResult | null {
  if (hotel.code === undefined || hotel.code === null) return null;
  const rates = hbToRates(hotel, query);
  if (rates.length === 0) return null;
  return {
    supplier_hotel_id: String(hotel.code),
    name_ar: hotel.name ?? String(hotel.code),
    star_rating: hbStars(hotel.categoryCode),
    thumbnail_url: null,
    rates,
  };
}

/**
 * Almosafer DEMO adapter — serves the captured real-data snapshot through the
 * exact same HotelSupplier contract every other supplier uses, so the existing
 * hotels-stage search shows genuine Almosafer results with zero UI changes.
 *
 * It is NOT a live integration: no network call, prices are the captured
 * per-night rates scaled to the itinerary's nights. supplier_name carries the
 * «عرض توضيحي» label so the origin is unmistakable in the UI and the document.
 * Selected only when code === "almosafer", which only happens under
 * ALMOSAFER_DEMO=1 — it can never be reached by accident in production.
 */
class AlmosaferDemoHotelSupplier implements HotelSupplier {
  readonly code = "almosafer";
  readonly name = ALMOSAFER_DEMO_LABEL;

  async testConnection(): Promise<TestConnectionResult> {
    return { ok: true, message: "وضع العرض التوضيحي فعّال — بيانات المسافر الحقيقية الملتقطة.", sampleCount: 0 };
  }

  async searchHotels(query: HotelSearchQuery): Promise<SupplierHotelSearchResult[]> {
    const key = almosaferDemoCityKey(query.city);
    if (!key) return [];
    const nights = Math.max(1, nightsBetween(query.check_in, query.check_out));
    const occupancy = {
      adults: Math.max(1, query.adults),
      children: Math.max(0, query.children),
      rooms: Math.max(1, query.rooms),
    };
    return (ALMOSAFER_DEMO_HOTELS[key] ?? []).map((h): SupplierHotelSearchResult => {
      const inclusive = Number((h.perNight * nights).toFixed(2));
      const rate: SupplierRate = {
        supplier_id: "almosafer",
        supplier_name: ALMOSAFER_DEMO_LABEL,
        rate_key: `almosafer-demo-${h.id}`,
        hotel_id: String(h.id),
        hotel_name: h.name,
        check_in: query.check_in,
        check_out: query.check_out,
        occupancy,
        room_category_raw: "Standard",
        board_type: h.board,
        refundable: h.freeCancellation,
        cancellation_policy: h.freeCancellation ? "إلغاء مجاني (حسب سياسة الفندق)" : "غير قابل للإلغاء",
        inclusive,
        currency: "SAR",
        surcharges: [],
        ref_sell: null,
        valid_until: null,
      };
      return {
        supplier_hotel_id: String(h.id),
        name_ar: h.name,
        star_rating: h.star,
        thumbnail_url: h.image,
        rates: [rate],
      };
    });
  }

  async searchRates(query: HotelSearchQuery & { supplier_hotel_id: string }): Promise<SupplierRate[]> {
    const all = await this.searchHotels(query);
    return all.find((h) => h.supplier_hotel_id === query.supplier_hotel_id)?.rates ?? [];
  }

  async fetchContent(supplierHotelId: string): Promise<SupplierHotelContent | null> {
    for (const list of Object.values(ALMOSAFER_DEMO_HOTELS)) {
      const h = list.find((x) => String(x.id) === supplierHotelId);
      if (h) {
        return {
          supplier_hotel_id: supplierHotelId,
          name_ar: h.name,
          name_en: null,
          star_rating: h.star,
          address: h.district,
          lat: h.lat,
          lng: h.lng,
          description: null,
          images: [{ url: h.image, order: 0, caption: null }],
          facilities: [],
          room_type_catalogue: [],
          check_in_time: null,
          check_out_time: null,
        };
      }
    }
    return null;
  }
}

/** Build the adapter for a supplier code from its (already-decrypted) credentials. */
export function buildHotelSupplier(
  code: string,
  creds: SupplierCredentials | null,
  baseUrl: string | null,
  environment: SupplierEnvironment = "live",
  /** where each request/response pair goes; omitted in tests and read paths. */
  record: SupplierCallRecorder | null = null,
): HotelSupplier {
  if (code === "tbo") return new TboHotelSupplier(creds, baseUrl, environment, record);
  if (code === "hotelbeds") return new HotelbedsHotelSupplier(creds, baseUrl);
  if (code === "almosafer") return new AlmosaferDemoHotelSupplier();
  return new MockHotelSupplier();
}

export { MockHotelSupplier };
