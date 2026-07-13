/**
 * Hotel search behind a stable provider interface. A mock adapter runs now;
 * a real provider (TBO / Amadeus / Hotelbeds) can be added later WITHOUT
 * changing callers — it is only selected when its credentials exist in the
 * environment. Rates flow into the pricing engine (src/lib/pricing) which is
 * N-supplier ready; today exactly one supplier is live.
 */

import type { SupplierRate } from "@/lib/pricing/rate-types";

export type HotelSearchParams = {
  city: string;
  minStars?: number;
  roomType?: string;
  maxPrice?: number;
  currency?: string;
};

export type HotelResult = {
  id: string;
  name: string;
  stars: number;
  roomType: string;
  board: string;
  price: number;
  currency: string;
};

/** Params for a rate quote (net rates for one hotel/stay). */
export type RateSearchParams = {
  hotel_id: string;
  hotel_name: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  rooms: number;
};

export interface HotelProvider {
  readonly id: string;
  search(params: HotelSearchParams): Promise<HotelResult[]>;
  /**
   * Net rates for one hotel/stay. Multiple rates per hotel (board × room ×
   * refundability) — the pricing engine normalizes + ranks the comparable ones.
   */
  searchHotelRates(params: RateSearchParams): Promise<SupplierRate[]>;
}

const ROOM_TYPES = ["ديلوكس", "غرفة سوبيريور", "جناح", "غرفة عائلية"];
const BOARDS = ["شامل الإفطار", "إفطار وعشاء", "بدون وجبات"];
const HOTEL_PREFIXES = ["فندق سيزونز", "فندق ماريوت", "فندق سترايبس", "فندق بارك رويال", "فندق جراند", "فندق نوفوتيل"];

class MockHotelProvider implements HotelProvider {
  readonly id = "mock";

  async search(params: HotelSearchParams): Promise<HotelResult[]> {
    const currency = params.currency ?? "SAR";
    const all: HotelResult[] = HOTEL_PREFIXES.map((prefix, index) => {
      const stars = 5 - (index % 3); // 5,4,3 repeating
      const roomType = ROOM_TYPES[index % ROOM_TYPES.length];
      const price = 320 + index * 140 + (stars - 3) * 260;
      return {
        id: `mock-${index}`,
        name: `${prefix} ${params.city}`,
        stars,
        roomType,
        board: BOARDS[index % BOARDS.length],
        price,
        currency,
      };
    });

    return all
      .filter((h) => (params.minStars ? h.stars >= params.minStars : true))
      .filter((h) => (params.roomType ? h.roomType === params.roomType : true))
      .filter((h) => (params.maxPrice ? h.price <= params.maxPrice : true))
      .sort((a, b) => a.price - b.price);
  }

  async searchHotelRates(params: RateSearchParams): Promise<SupplierRate[]> {
    const nights = Math.max(diffNights(params.check_in, params.check_out), 1);
    const rooms = Math.max(params.rooms, 1);
    // deterministic per-hotel base rate (USD/night) so results are stable
    const seed = [...params.hotel_id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 40;
    const perNight = 70 + seed * 3;
    const stayUnits = nights * rooms;
    const base = perNight * stayUnits;

    // Three rates for the SAME room/dates/occupancy but different board &
    // refundability — the engine must group the comparable ones and NEVER rank
    // the non-refundable RO against the refundable half-board.
    return [
      {
        supplier_id: this.id,
        supplier_name: "TBO Holidays",
        rate_key: `${params.hotel_id}-BB-REF`,
        hotel_id: params.hotel_id,
        hotel_name: params.hotel_name,
        check_in: params.check_in,
        check_out: params.check_out,
        occupancy: { adults: params.adults, children: params.children, rooms },
        room_category_raw: "Deluxe Room",
        board_type: "BB",
        refundable: true,
        cancellation_policy: "إلغاء مجاني حتى 48 ساعة قبل موعد الوصول، وبعدها تُطبَّق رسوم ليلة واحدة.",
        inclusive: round2(base * 1.12), // net incl. taxes
        currency: "USD",
        surcharges: [
          { name: "ضريبة الخدمة", amount: round2(base * 0.05), currency: "USD", charge: "Mandatory" },
          { name: "رسوم المنتجع (تُدفع بالفندق)", amount: 15 * nights, currency: "USD", charge: "Excluded" },
        ],
        ref_sell: round2(base * 1.12 * 1.05), // supplier min-sell floor
        valid_until: params.check_in,
      },
      {
        supplier_id: this.id,
        supplier_name: "TBO Holidays",
        rate_key: `${params.hotel_id}-HB-REF`,
        hotel_id: params.hotel_id,
        hotel_name: params.hotel_name,
        check_in: params.check_in,
        check_out: params.check_out,
        occupancy: { adults: params.adults, children: params.children, rooms },
        room_category_raw: "Deluxe Room",
        board_type: "HB",
        refundable: true,
        cancellation_policy: "إلغاء مجاني حتى 72 ساعة قبل موعد الوصول.",
        inclusive: round2(base * 1.32),
        currency: "USD",
        surcharges: [{ name: "ضريبة الخدمة", amount: round2(base * 0.05), currency: "USD", charge: "Mandatory" }],
        ref_sell: null,
        valid_until: params.check_in,
      },
      {
        supplier_id: this.id,
        supplier_name: "TBO Holidays",
        rate_key: `${params.hotel_id}-RO-NRF`,
        hotel_id: params.hotel_id,
        hotel_name: params.hotel_name,
        check_in: params.check_in,
        check_out: params.check_out,
        occupancy: { adults: params.adults, children: params.children, rooms },
        room_category_raw: "Standard Room",
        board_type: "RO",
        refundable: false,
        cancellation_policy: "غير قابل للاسترداد — لا يمكن الإلغاء أو التعديل.",
        inclusive: round2(base * 0.92),
        currency: "USD",
        surcharges: [{ name: "ضريبة الخدمة", amount: round2(base * 0.05), currency: "USD", charge: "Mandatory" }],
        ref_sell: null,
        valid_until: params.check_in,
      },
    ];
  }
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
function diffNights(a: string, b: string): number {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 1;
  return Math.max(Math.round((t2 - t1) / 86_400_000), 1);
}

/**
 * Returns the active hotel provider. Real providers require credentials; until
 * they are present in the environment we fall back to the mock so the UI works.
 */
export function getHotelProvider(): HotelProvider {
  const selected = process.env.HOTEL_PROVIDER ?? "mock";
  if (selected === "amadeus" && process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) {
    // A real AmadeusHotelProvider would be constructed here once credentials exist.
    // Not implemented yet — no live calls without configured keys.
  }
  return new MockHotelProvider();
}
