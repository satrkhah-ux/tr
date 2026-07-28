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
}

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
class TboHotelSupplier implements HotelSupplier {
  readonly code = "tbo";
  readonly name = "TBO Holidays";
  private readonly creds: SupplierCredentials | null;
  private readonly baseUrl: string;
  /** true when the row says 'sandbox' but no sandbox host was ever entered. */
  private readonly unsafeSandbox: boolean;

  constructor(creds: SupplierCredentials | null, baseUrl: string | null, environment: SupplierEnvironment = "live") {
    this.creds = creds;
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
   * One TBO call. Returns null on any failure — the caller shows "no results",
   * never a fabricated one. The supplier's own error text is deliberately not
   * propagated to the UI: it can leak the endpoint and the account identity.
   */
  private async call<T extends TboStatus>(path: string, body?: unknown): Promise<T | null> {
    const url = `${this.baseUrl}/${path}`;
    try {
      const res = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: this.authHeader(),
          "content-type": "application/json",
          accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
        cache: "no-store",
      });
      const text = await res.text();
      let json: T | null = null;
      try {
        json = JSON.parse(text) as T;
      } catch {
        /* non-JSON body — reported below */
      }
      const code = json?.Status?.Code;
      const ok = res.ok && (typeof code !== "number" || code === 200 || code === 201);
      if (!ok) {
        // SERVER LOG ONLY, and deliberately never the Authorization header or
        // the credentials: without this line a failure is undiagnosable — you
        // cannot tell a wrong password from a wrong path from a dead network.
        console.warn(
          `[tbo] ${path} failed — http=${res.status} bodyCode=${code ?? "none"} ` +
            `desc=${json?.Status?.Description ?? text.slice(0, 200)}`,
        );
        return null;
      }
      return json;
    } catch (err) {
      console.warn(`[tbo] ${path} threw — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
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
): HotelSupplier {
  if (code === "tbo") return new TboHotelSupplier(creds, baseUrl, environment);
  if (code === "hotelbeds") return new HotelbedsHotelSupplier(creds, baseUrl);
  if (code === "almosafer") return new AlmosaferDemoHotelSupplier();
  return new MockHotelSupplier();
}

export { MockHotelSupplier };
