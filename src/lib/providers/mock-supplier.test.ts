import { describe, expect, it } from "vitest";
import { buildHotelSupplier } from "./hotel-supplier";

/**
 * The demo engine, which is what the generator runs against while TBO's account
 * sits unactivated.
 *
 * Worth its own test for one reason: it is the only supplier allowed to invent
 * data, so the boundary matters. It must produce a complete, priceable result
 * for any city WITHOUT a network or a country code — and it must stay
 * deterministic, or a re-search would silently reprice a package the agent had
 * already quoted.
 */
const QUERY = {
  city: "اسطنبول",
  check_in: "2026-08-01",
  check_out: "2026-08-05",
  adults: 2,
  children: 0,
  rooms: 1,
};

describe("the demo supplier", () => {
  it("answers any city with priceable hotels, with no network and no country code", async () => {
    const mock = buildHotelSupplier("mock", null, null);
    const hotels = await mock.searchHotels(QUERY);

    expect(hotels.length).toBeGreaterThan(0);
    for (const h of hotels) {
      expect(h.name_ar).not.toBe("");
      expect(h.rates.length).toBeGreaterThan(0);
      for (const r of h.rates) {
        expect(r.inclusive).toBeGreaterThan(0);
        expect(r.rate_key).not.toBe("");
        expect(r.currency).not.toBe("");
      }
    }
  });

  it("returns the SAME hotels and prices on a re-search", async () => {
    // A quoted package must not move under the agent because they pressed
    // search twice.
    const mock = buildHotelSupplier("mock", null, null);
    const first = await mock.searchHotels(QUERY);
    const again = await mock.searchHotels(QUERY);

    expect(again.map((h) => h.supplier_hotel_id)).toEqual(first.map((h) => h.supplier_hotel_id));
    expect(again.map((h) => h.rates[0]?.inclusive)).toEqual(first.map((h) => h.rates[0]?.inclusive));
  });

  it("gives a different city different hotels", async () => {
    const mock = buildHotelSupplier("mock", null, null);
    const istanbul = await mock.searchHotels(QUERY);
    const baku = await mock.searchHotels({ ...QUERY, city: "باكو" });
    expect(baku.map((h) => h.supplier_hotel_id)).not.toEqual(istanbul.map((h) => h.supplier_hotel_id));
  });

  it("can be re-priced for one hotel, which is what selecting a rate does", async () => {
    const mock = buildHotelSupplier("mock", null, null);
    const [first] = await mock.searchHotels(QUERY);
    const rates = await mock.searchRates({ ...QUERY, supplier_hotel_id: first.supplier_hotel_id });

    expect(rates.length).toBeGreaterThan(0);
    // Selecting re-fetches and matches by rate_key; a mismatch here is the
    // "rate expired" message an agent would see one second after choosing.
    expect(rates.some((r) => r.rate_key === first.rates[0].rate_key)).toBe(true);
  });

  it("cannot be booked — the demo engine has no booking methods at all", () => {
    const mock = buildHotelSupplier("mock", null, null);
    expect(typeof mock.prebook).toBe("undefined");
    expect(typeof mock.book).toBe("undefined");
  });
});
