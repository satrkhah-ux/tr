import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HotelSupplier, SupplierHotelSearchResult } from "@/lib/providers/hotel-supplier";
import type { SupplierRate } from "@/lib/pricing/rate-types";
import { cityKeys, emptyDraftData, normalizeDraftData, normalizeDraftHotel, type DraftData } from "@/lib/offer/draft-types";
import { rateKey, type CandidateHotel } from "./suggest-core";
import { tboSource, type SuggestContext } from "./suggest-sources";

/** TBO fixtures: the adapter is injected, nothing leaves the test. */
const ROOM = rateKey("مزدوجة", "BB");
const market: CandidateHotel[] = [{ id: "h-old-wall", name: "Old Wall", stars: 4, rates: { [ROOM]: { perNight: 100, currency: "USD" } } }];

function draft(): DraftData {
  const base = emptyDraftData();
  const keys = cityKeys([{ city_name: "تبليسي" }]);
  return normalizeDraftData({
    ...base,
    trip: { ...base.trip, country: "جورجيا", destination: "جورجيا", arrival_date: "2026-12-01", days: 3, nights: 2, adults: 2, rooms: 1 },
    cities: [{ key: keys[0], city_name: "تبليسي", nights: 2, check_in: "2026-12-01", check_out: "2026-12-03" }],
    hotels: [normalizeDraftHotel({ city_key: keys[0], city_name: "تبليسي", hotel_id: "h-old-wall", hotel_name: "Old Wall", rooms: [{ room_type_id: null, room_type_name: "مزدوجة", board_type: "BB", price: null }] })],
  } as unknown as Record<string, unknown>);
}

const rate = (inclusive: number, currency = "SAR"): SupplierRate => ({
  supplier_id: "tbo", supplier_name: "TBO", rate_key: "rk", hotel_id: "x", hotel_name: "x",
  check_in: "2026-12-01", check_out: "2026-12-03", occupancy: { adults: 2, children: 0, rooms: 1 } as SupplierRate["occupancy"],
  room_category_raw: "Double", board_type: "BB", refundable: true, cancellation_policy: "مجاني حتى 28/11",
  inclusive, currency, surcharges: [], ref_sell: null, valid_until: null,
} as unknown as SupplierRate);

const hit = (id: string, name: string, stars: number | null, rates: SupplierRate[]): SupplierHotelSearchResult => ({
  supplier_hotel_id: id, name_ar: name, star_rating: stars, thumbnail_url: null, rates,
});

const fakeDb = {
  from: (table: string) => ({
    select: () => {
      const rows = table === "countries" ? [{ id: "c1", arabic_name: "جورجيا", iso2: "GE" }] : null;
      const result = { data: rows };
      return Object.assign(Promise.resolve(result), {
        eq: () => Promise.resolve({ data: [{ arabic_name: "تبليسي", english_name: "Tbilisi" }] }),
      });
    },
  }),
} as unknown as SupabaseClient;

const adapter = (results: SupplierHotelSearchResult[] | Error): HotelSupplier => ({
  code: "tbo", name: "TBO",
  testConnection: async () => ({ ok: true, message: "" }),
  searchHotels: async () => { if (results instanceof Error) throw results; return results; },
  searchRates: async () => [],
  fetchContent: async () => null,
});

function ctx(tbo: HotelSupplier | null): SuggestContext {
  const d = draft();
  return {
    draft: d, stay: d.hotels[0], cityName: "تبليسي", nights: 2,
    checkIn: "2026-12-01", checkOut: "2026-12-03",
    memoryMarket: market, sarPer: { USD: 3.75 }, db: fakeDb, tboAdapter: tbo,
  };
}

// the baseline: Old Wall 100 USD × ليلتان × 3.75 = 750 ريال
describe("tboSource", () => {
  it("same stars, SAR-cheaper only, sorted, with the policy — and never a written price", async () => {
    const out = await tboSource.alternativesFor(ctx(adapter([
      hit("t1", "TBO Cheap", 4, [rate(500), rate(600)]),
      hit("t2", "TBO Mid", 4, [rate(700)]),
      hit("t3", "TBO Pricier", 4, [rate(900)]),
      hit("t4", "TBO Low Class", 3, [rate(100)]),
      hit("t5", "TBO No Stars", null, [rate(100)]),
    ])));
    expect(out.map((o) => o.hotelName)).toEqual(["TBO Cheap", "TBO Mid"]);
    expect(out[0]).toMatchObject({ source: "tbo", staySar: 500, saveSar: 250, cancellation: "مجاني حتى 28/11", supplierHotelId: "t1" });
    expect(out[0].roomPrices).toBeUndefined();
  });
  it("a failing or missing adapter answers with nothing, silently", async () => {
    expect(await tboSource.alternativesFor(ctx(adapter(new Error("500"))))).toEqual([]);
    expect(await tboSource.alternativesFor(ctx(null))).toEqual([]);
  });
  it("no dates or no baseline → nothing (never a blind search)", async () => {
    const c = ctx(adapter([hit("t1", "TBO Cheap", 4, [rate(100)])]));
    expect(await tboSource.alternativesFor({ ...c, checkIn: null })).toEqual([]);
    expect(await tboSource.alternativesFor({ ...c, memoryMarket: [] })).toEqual([]);
  });
});
