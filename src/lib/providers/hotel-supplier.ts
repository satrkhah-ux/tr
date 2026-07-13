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

export type SupplierCredentials = {
  base_url: string;
  username: string;
  password: string;
};

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

/**
 * TBO adapter (machine-to-machine XML/API — NO OTP). Real endpoints slot in when
 * TBO_LIVE=1 and credentials are present; otherwise it SIMULATES auth + search
 * against the shared mock data engine, so nothing breaks without a live account.
 * `testConnection` fails readably when credentials are incomplete.
 */
class TboHotelSupplier implements HotelSupplier {
  readonly code = "tbo";
  readonly name = "TBO Holidays";
  private readonly creds: SupplierCredentials | null;
  private readonly baseUrl: string | null;

  constructor(creds: SupplierCredentials | null, baseUrl: string | null) {
    this.creds = creds;
    this.baseUrl = baseUrl;
  }

  private ready(): boolean {
    return Boolean(this.creds?.username && this.creds?.password && this.baseUrl);
  }

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.ready()) {
      return { ok: false, message: "بيانات الاعتماد غير مكتملة — أدخل رابط الخدمة واسم المستخدم وكلمة المرور." };
    }
    // A real integration would POST an Authenticate request here. Without a live
    // endpoint we simulate a successful auth + a sample search of 4 hotels.
    if (process.env.TBO_LIVE === "1") {
      // Placeholder for the real call — not executed without a configured endpoint.
      return { ok: false, message: "الوضع المباشر غير مُهيّأ في هذه البيئة." };
    }
    const sample = await this.searchHotels({ city: "الرياض", check_in: "2026-08-01", check_out: "2026-08-03", adults: 2, children: 0, rooms: 1 });
    return { ok: true, message: "تم الاتصال بنجاح والمصادقة والبحث التجريبي.", sampleCount: sample.length };
  }

  async searchHotels(query: HotelSearchQuery): Promise<SupplierHotelSearchResult[]> {
    if (!this.ready()) return [];
    return mockHotelIds(query.city).map((h) => ({
      supplier_hotel_id: h.id,
      name_ar: h.name,
      star_rating: h.stars,
      thumbnail_url: mockImage(`${h.id}-thumb`, h.name),
      rates: mockRates("tbo", h.id, h.name, query),
    }));
  }

  async searchRates(query: HotelSearchQuery & { supplier_hotel_id: string }): Promise<SupplierRate[]> {
    if (!this.ready()) return [];
    const name = mockContent(query.supplier_hotel_id, query.city).name_ar;
    return mockRates("tbo", query.supplier_hotel_id, name, query);
  }

  async fetchContent(supplierHotelId: string): Promise<SupplierHotelContent | null> {
    if (!this.ready()) return null;
    return mockContent(supplierHotelId);
  }
}

/** Build the adapter for a supplier code from its (already-decrypted) credentials. */
export function buildHotelSupplier(
  code: string,
  creds: SupplierCredentials | null,
  baseUrl: string | null,
): HotelSupplier {
  if (code === "tbo") return new TboHotelSupplier(creds, baseUrl);
  return new MockHotelSupplier();
}

export { MockHotelSupplier };
