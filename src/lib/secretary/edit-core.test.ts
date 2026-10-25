import { describe, expect, it } from "vitest";
import { emptyDraftData, normalizeDraftData, normalizeDraftHotel, cityKeys, type DraftData } from "@/lib/offer/draft-types";
import { applyClientEdit, type ClientEditPlan } from "./edit-core";

const plan = (over: Partial<ClientEditPlan>): ClientEditPlan => ({
  remove_cities: [], keep_only_cities: [], set_days: null, set_adults: null, set_rooms: null, set_arrival: null, summary: "", beyond: "", ...over,
});

function georgia(): DraftData {
  const base = emptyDraftData();
  const route = [
    { city: "تبليسي", nights: 2, hotel: "Old Wall" },
    { city: "باتومي", nights: 3, hotel: "Black Sea" },
  ];
  const keys = cityKeys(route.map((r) => ({ city_name: r.city })));
  return normalizeDraftData({
    ...base,
    customer: { ...base.customer, customer_name: "أبو فهد", customer_phone: "9665xxxxxxx" },
    trip: { ...base.trip, country: "جورجيا", destination: "جورجيا", arrival_date: "2026-12-01", days: 6, nights: 5, adults: 2, rooms: 1 },
    cities: route.map((r, k) => ({ key: keys[k], city_name: r.city, nights: r.nights, check_in: null, check_out: null })),
    hotels: route.map((r, k) => normalizeDraftHotel({ city_key: keys[k], city_name: r.city, hotel_name: r.hotel, rooms: [{ room_type_id: null, room_type_name: "مزدوجة", board_type: "BB", price: 500 }] })),
    pricing: { items: [], display_currency: "SAR", final_total: 4000 },
    source: { ready_offer_id: "x", code: "x", tier: "", title: "عرض", valid_from: null, valid_to: null },
  } as unknown as Record<string, unknown>);
}

describe("applyClientEdit", () => {
  it("«احذف باتومي وأبقِ تبليسي»: drops the city and its hotel, unlocks the total, flags the review", () => {
    const r = applyClientEdit(georgia(), plan({ remove_cities: ["الباتومي"] }));
    expect(r.changed).toBe(true);
    expect(r.data.cities.map((c) => c.city_name)).toEqual(["تبليسي"]);
    expect(r.data.hotels.map((h) => h.city_name)).toEqual(["تبليسي"]);
    expect(r.data.trip.nights).toBe(2);
    expect(r.data.trip.days).toBe(3);
    expect(r.data.pricing.final_total).toBeNull();
    expect(r.data.source).toBeNull();
    expect(r.data.produced_serial ?? null).toBeNull();
    expect(r.flags.join(" ")).toContain("راجع");
  });

  it("keep_only wins, unknown names change nothing, and zero cities is refused", () => {
    const keep = applyClientEdit(georgia(), plan({ keep_only_cities: ["باتومي"], remove_cities: ["باتومي"] }));
    expect(keep.data.cities.map((c) => c.city_name)).toEqual(["باتومي"]);
    const unknown = applyClientEdit(georgia(), plan({ remove_cities: ["دبي"] }));
    expect(unknown.changed).toBe(false);
    expect(unknown.data.cities).toHaveLength(2);
    const none = applyClientEdit(georgia(), plan({ keep_only_cities: ["دبي"] }));
    expect(none.changed).toBe(false);
    expect(none.data.cities).toHaveLength(2);
  });

  it("set_days re-splits nights in proportion and flags re-pricing of moved stays", () => {
    const r = applyClientEdit(georgia(), plan({ set_days: 11 }));
    expect(r.data.trip.nights).toBe(10);
    expect(r.data.cities.reduce((n, c) => n + c.nights, 0)).toBe(10);
    expect(r.flags.join(" ")).toContain("لكامل الإقامة");
  });

  it("the original object is never mutated", () => {
    const d = georgia();
    const before = JSON.stringify(d);
    applyClientEdit(d, plan({ remove_cities: ["تبليسي"], set_days: 4, set_adults: 4 }));
    expect(JSON.stringify(d)).toBe(before);
  });
});
