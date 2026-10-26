import { describe, expect, it } from "vitest";
import { cityKeys, emptyDraftData, normalizeDraftData, normalizeDraftHotel, type DraftData } from "@/lib/offer/draft-types";
import { buildSuggestions, memoryAlternatives, rateKey, type CandidateHotel, type StayAlternative } from "./suggest-core";

/** the owner's test: تبليسي من 1 إلى 3 + باتومي من 3 إلى 8، بفندقين اختارهما الموظف */
const ROOM = rateKey("مزدوجة", "BB");
const SAR = { USD: 3.75 } as Record<string, number>;
const hotel = (id: string, name: string, stars: number | null, perNight: number | null, currency = "USD"): CandidateHotel => ({
  id, name, stars, rates: perNight == null ? {} : { [ROOM]: { perNight, currency } },
});

function georgia(): DraftData {
  const base = emptyDraftData();
  const route = [
    { city: "تبليسي", nights: 2, hotel: "Old Wall", id: "h-old-wall" },
    { city: "باتومي", nights: 5, hotel: "Black Sea", id: "h-black-sea" },
  ];
  const keys = cityKeys(route.map((r) => ({ city_name: r.city })));
  return normalizeDraftData({
    ...base,
    customer: { ...base.customer, customer_name: "أبو فهد" },
    trip: { ...base.trip, country: "جورجيا", destination: "جورجيا", arrival_date: "2026-12-01", days: 8, nights: 7, adults: 2, rooms: 1 },
    cities: route.map((r, k) => ({ key: keys[k], city_name: r.city, nights: r.nights, check_in: null, check_out: null })),
    hotels: route.map((r, k) => normalizeDraftHotel({ city_key: keys[k], city_name: r.city, hotel_id: r.id, hotel_name: r.hotel, rooms: [{ room_type_id: null, room_type_name: "مزدوجة", board_type: "BB", price: null }] })),
  } as unknown as Record<string, unknown>);
}

const tbilisi = [
  hotel("h-old-wall", "Old Wall", 4, 100),
  hotel("h-cheap-4", "Tbilisi Inn", 4, 70),
  hotel("h-cheaper-4", "Garden Inn", 4, 60),
  hotel("h-cheap-3", "Budget 3", 3, 20), // lower class: never offered
  hotel("h-no-rate", "No Rate", 4, null), // unknown price: never offered
  hotel("h-pricier", "Palace", 4, 150),
];
const batumi = [
  hotel("h-black-sea", "Black Sea", 4, 120),
  hotel("h-sea-4", "Sea View", 4, 90),
];

const tboAlt = (name: string, staySar: number): StayAlternative => ({
  source: "tbo", hotelId: null, supplierHotelId: `t-${name}`, hotelName: name, stars: 4,
  staySar, saveSar: 100, board: "BB", cancellation: "مجاني حتى قبل 3 أيام", refundable: true,
});

describe("memoryAlternatives", () => {
  it("same stars only, known cheaper prices only, cheapest first, trusted prices filled, SAR figures set", () => {
    const d = georgia();
    const out = memoryAlternatives(d.hotels[0], 2, tbilisi, SAR);
    expect(out.map((o) => o.hotelName)).toEqual(["Garden Inn", "Tbilisi Inn"]);
    expect(out[0].roomPrices).toEqual({ prices: [120], currency: "USD" }); // 60 × ليلتان
    expect(out[0].staySar).toBe(Math.round(60 * 2 * 3.75));
    expect(out[0].saveSar).toBe(Math.round((100 - 60) * 2 * 3.75));
    expect(out[0].source).toBe("memory");
  });
  it("unknown original stars or no baseline → nothing", () => {
    const d = georgia();
    expect(memoryAlternatives(d.hotels[0], 2, [hotel("h-old-wall", "Old Wall", null, 100), hotel("x", "X", 4, 50)], SAR)).toEqual([]);
    expect(memoryAlternatives(d.hotels[0], 2, [hotel("h-old-wall", "Old Wall", 4, null), hotel("x", "X", 4, 50)], SAR)).toEqual([]);
  });
});

describe("buildSuggestions", () => {
  it("variant k takes the k-th alternative; memory prices written, route and dates untouched", () => {
    const d = georgia();
    const alts = new Map([
      [d.cities[0].key!, memoryAlternatives(d.hotels[0], 2, tbilisi, SAR)],
      [d.cities[1].key!, memoryAlternatives(d.hotels[1], 5, batumi, SAR)],
    ]);
    const out = buildSuggestions(d, alts, 2);
    expect(out).toHaveLength(2);
    expect(out[0].data.hotels.map((h) => h.hotel_name)).toEqual(["Garden Inn", "Sea View"]);
    expect(out[0].data.hotels[0].rooms[0].price).toBe(120);
    expect(out[0].data.hotels[1].rooms[0].price).toBe(450);
    expect(out[0].unverified).toBe(false);
    expect(out[1].data.hotels.map((h) => h.hotel_name)).toEqual(["Tbilisi Inn", "Sea View"]);
    expect(out[0].data.cities.map((c) => [c.city_name, c.nights])).toEqual([["تبليسي", 2], ["باتومي", 5]]);
    expect(out[0].data.trip.arrival_date).toBe("2026-12-01");
    expect(out[0].data.produced_serial ?? null).toBeNull();
  });

  it("a TBO alternative swaps the hotel but writes NO price — the variant is marked unverified", () => {
    const d = georgia();
    const alts = new Map([[d.cities[0].key!, [tboAlt("Cheap TBO", 300)]]]);
    const out = buildSuggestions(d, alts, 2);
    expect(out).toHaveLength(1);
    const stay = out[0].data.hotels[0];
    expect(stay.hotel_name).toBe("Cheap TBO");
    expect(stay.hotel_id).toBeNull();
    expect(stay.rooms[0].price).toBeNull();
    expect(out[0].unverified).toBe(true);
    expect(out[0].swapped[0]).toMatchObject({ source: "tbo", cancellation: "مجاني حتى قبل 3 أيام" });
  });

  it("no cheaper anywhere → no variants; a repeated combination is dropped", () => {
    const d = georgia();
    expect(buildSuggestions(d, new Map(), 2)).toEqual([]);
    const only = new Map([[d.cities[1].key!, memoryAlternatives(d.hotels[1], 5, batumi, SAR)]]);
    expect(buildSuggestions(d, only, 2)).toHaveLength(1);
  });
});
