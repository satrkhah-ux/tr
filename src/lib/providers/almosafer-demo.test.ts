import { describe, expect, it } from "vitest";
import { buildHotelSupplier, type HotelSearchQuery } from "./hotel-supplier";
import { almosaferDemoCityKey, ALMOSAFER_DEMO_LABEL } from "./almosafer-demo";

/**
 * The Almosafer DEMO supplier serves a captured real-data snapshot through the
 * standard HotelSupplier contract. These tests pin the behaviour the management
 * demo relies on: real hotels for the captured cities, honest per-night → total
 * scaling, an unmistakable «عرض توضيحي» label, and — critically — NO results
 * for a city we did not capture (never invent one).
 */

const query = (city: string, nights: number): HotelSearchQuery => ({
  city,
  check_in: "2026-08-01",
  check_out: `2026-08-0${1 + nights}`,
  adults: 2,
  children: 0,
  rooms: 1,
});

describe("almosaferDemoCityKey", () => {
  it("maps Arabic and English name variants onto the fixture keys", () => {
    expect(almosaferDemoCityKey("كوالالمبور")).toBe("kuala lumpur");
    expect(almosaferDemoCityKey("كوالا لمبور")).toBe("kuala lumpur");
    expect(almosaferDemoCityKey("Kuala Lumpur")).toBe("kuala lumpur");
    expect(almosaferDemoCityKey("لنكاوي")).toBe("langkawi");
    expect(almosaferDemoCityKey("Langkawi")).toBe("langkawi");
  });

  it("maps the newly-added destinations (Bangkok, Bali, Istanbul)", () => {
    expect(almosaferDemoCityKey("بانكوك")).toBe("bangkok");
    expect(almosaferDemoCityKey("بالي")).toBe("bali");
    expect(almosaferDemoCityKey("أوبود")).toBe("bali");
    expect(almosaferDemoCityKey("اسطنبول")).toBe("istanbul");
    expect(almosaferDemoCityKey("Istanbul")).toBe("istanbul");
  });

  it("returns null for a city we did not capture", () => {
    expect(almosaferDemoCityKey("سيلانجور")).toBeNull();
    expect(almosaferDemoCityKey("Paris")).toBeNull();
  });
});

describe("Almosafer demo supplier", () => {
  const supplier = buildHotelSupplier("almosafer", null, null);

  it("returns real captured hotels for Kuala Lumpur, labelled as a demo", async () => {
    const results = await supplier.searchHotels(query("كوالالمبور", 3));
    expect(results.length).toBeGreaterThan(0);
    // a hotel from the real snapshot
    const banyan = results.find((h) => h.name_ar.includes("بافيليون"));
    expect(banyan).toBeDefined();
    expect(banyan?.star_rating).toBe(5);
    const rate = banyan!.rates[0];
    expect(rate.supplier_name).toBe(ALMOSAFER_DEMO_LABEL);
    expect(rate.currency).toBe("SAR");
    // captured per-night 676 × 3 nights
    expect(rate.inclusive).toBe(2028);
  });

  it("scales the captured per-night rate to the itinerary's own nights", async () => {
    const two = await supplier.searchHotels(query("كوالالمبور", 2));
    const banyan = two.find((h) => h.name_ar.includes("بافيليون"))!;
    expect(banyan.rates[0].inclusive).toBe(1352); // 676 × 2
  });

  it("returns nothing for an uncaptured city — never invents one", async () => {
    expect(await supplier.searchHotels(query("سيلانجور", 3))).toEqual([]);
    expect(await supplier.searchHotels(query("طوكيو", 3))).toEqual([]);
  });

  it("also serves Langkawi from the snapshot", async () => {
    const results = await supplier.searchHotels(query("لنكاوي", 3));
    expect(results.some((h) => h.name_ar.includes("ريتز") || h.name_ar.includes("سانت ريجيس"))).toBe(true);
  });

  it("covers the four extra destinations captured for the demo", async () => {
    for (const city of ["بانكوك", "بالي", "اسطنبول"]) {
      const results = await supplier.searchHotels(query(city, 3));
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].rates[0].currency).toBe("SAR");
      expect(results[0].rates[0].supplier_name).toBe(ALMOSAFER_DEMO_LABEL);
    }
  });
});
