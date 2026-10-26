import { describe, expect, it } from "vitest";
import { cityKeys, emptyDraftData, normalizeDraftData, normalizeDraftHotel, type DraftData } from "@/lib/offer/draft-types";
import { buildSuggestions, cheaperForStay, rateKey, type CandidateHotel } from "./suggest-core";

/** the owner's test: تبليسي من 1 إلى 3 + باتومي من 3 إلى 8، بفندقين اختارهما الموظف */
const ROOM = rateKey("مزدوجة", "BB");
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

function market(d: DraftData): Map<string, CandidateHotel[]> {
  return new Map([[d.cities[0].key!, tbilisi], [d.cities[1].key!, batumi]]);
}

describe("cheaperForStay", () => {
  it("same stars only, known prices only, cheaper only — cheapest first", () => {
    const d = georgia();
    const out = cheaperForStay(d.hotels[0], 2, tbilisi);
    expect(out.map((o) => o.hotel.name)).toEqual(["Garden Inn", "Tbilisi Inn"]);
  });
  it("unknown original stars or no baseline → nothing", () => {
    const d = georgia();
    expect(cheaperForStay(d.hotels[0], 2, [hotel("h-old-wall", "Old Wall", null, 100), hotel("x", "X", 4, 50)])).toEqual([]);
    expect(cheaperForStay(d.hotels[0], 2, [hotel("h-old-wall", "Old Wall", 4, null), hotel("x", "X", 4, 50)])).toEqual([]);
  });
});

describe("buildSuggestions", () => {
  it("two variants: cheapest combo then the next, rooms priced per-night × nights, route and dates untouched", () => {
    const d = georgia();
    const out = buildSuggestions(d, market(d), 2);
    expect(out).toHaveLength(2);
    // proposal 1: Garden Inn (60×2) + Sea View (90×5)
    expect(out[0].data.hotels.map((h) => h.hotel_name)).toEqual(["Garden Inn", "Sea View"]);
    expect(out[0].data.hotels[0].rooms[0].price).toBe(120);
    expect(out[0].data.hotels[1].rooms[0].price).toBe(450);
    // proposal 2: second-cheapest in Tbilisi, Batumi falls back to its only cheaper one
    expect(out[1].data.hotels.map((h) => h.hotel_name)).toEqual(["Tbilisi Inn", "Sea View"]);
    // nothing else moved
    expect(out[0].data.cities.map((c) => [c.city_name, c.nights])).toEqual([["تبليسي", 2], ["باتومي", 5]]);
    expect(out[0].data.trip.arrival_date).toBe("2026-12-01");
    expect(out[0].data.produced_serial ?? null).toBeNull();
    expect(out[0].swapped).toHaveLength(2);
  });
  it("a city with nothing cheaper keeps its hotel; no swaps at all → no variants", () => {
    const d = georgia();
    const onlyBatumi = new Map([[d.cities[1].key!, batumi]]);
    const out = buildSuggestions(d, onlyBatumi, 2);
    expect(out).toHaveLength(1); // the second variant repeats the first and is dropped
    expect(out[0].data.hotels.map((h) => h.hotel_name)).toEqual(["Old Wall", "Sea View"]);
    expect(buildSuggestions(d, new Map(), 2)).toEqual([]);
  });
});
