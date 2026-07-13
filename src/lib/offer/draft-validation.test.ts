import { describe, it, expect } from "vitest";
import { deriveCityDates, emptyDraftData, normalizeDraftData, type DraftData } from "./draft-types";
import { validateDraft } from "./draft-validation";

function completeDraft(): DraftData {
  const data = emptyDraftData();
  data.customer = { customer_name: "نايف الجهني", customer_phone: "0555555555", company: "" };
  data.trip = {
    country: "ماليزيا",
    destination: "ماليزيا",
    arrival_date: "2026-06-01",
    departure_date: "2026-06-06",
    days: 6,
    nights: 5,
    adults: 2,
    children: 0,
    infants: 0,
  };
  data.cities = deriveCityDates("2026-06-01", [
    { city_name: "كوالالمبور", nights: 3, check_in: null, check_out: null },
    { city_name: "لنكاوي", nights: 2, check_in: null, check_out: null },
  ]);
  data.hotels = [
    { city_name: "كوالالمبور", hotel_id: "h1", hotel_name: "فندق 1", room_type_id: "rt1", room_type_name: "ديلوكس", board_type: "BB", rooms_count: 1 },
    { city_name: "لنكاوي", hotel_id: "h2", hotel_name: "فندق 2", room_type_id: "rt2", room_type_name: "سوبيريور", board_type: "HB", rooms_count: 1 },
  ];
  data.flights = [
    { airline: "SV", flight_no: "SV832", from_airport: "RUH", to_airport: "KUL", departure_at: "2026-06-01T01:00", arrival_at: "2026-06-01T14:00", from_tz: "Asia/Riyadh", to_tz: "Asia/Kuala_Lumpur", date_user_set: false, cabin_class: "Y", baggage_allowance: "30kg", leg_order: "outbound" },
  ];
  data.services = { includes: ["الفنادق"], excludes: [], terms: ["قابل للتعديل"] };
  data.pricing = {
    items: [{ item_type: "hotel", description: "فنادق", quantity: 1, buy_price: 1000, buy_currency: "SAR", sell_price: 1500, sell_currency: "SAR" }],
    display_currency: "SAR",
    final_total: 1500,
  };
  return data;
}

describe("deriveCityDates", () => {
  it("chains check-in/check-out from arrival through the nights order", () => {
    const cities = deriveCityDates("2026-06-01", [
      { city_name: "A", nights: 3, check_in: null, check_out: null },
      { city_name: "B", nights: 2, check_in: null, check_out: null },
    ]);
    expect(cities[0]).toMatchObject({ check_in: "2026-06-01", check_out: "2026-06-04" });
    expect(cities[1]).toMatchObject({ check_in: "2026-06-04", check_out: "2026-06-06" });
  });
  it("nulls dates when there is no arrival date", () => {
    const cities = deriveCityDates(null, [{ city_name: "A", nights: 3, check_in: "x", check_out: "y" }]);
    expect(cities[0].check_in).toBeNull();
    expect(cities[0].check_out).toBeNull();
  });
});

describe("validateDraft", () => {
  it("passes a complete draft with matching nights", () => {
    const result = validateDraft(completeDraft());
    expect(result.blocking).toHaveLength(0);
    expect(result.ok).toBe(true);
    expect(result.nights).toEqual({ used: 5, total: 5, match: true });
    expect(result.stages.cities).toBe("complete");
    expect(result.stages.hotels).toBe("complete");
  });

  it("BLOCKS on a nights mismatch and attributes it to the cities stage", () => {
    const data = completeDraft();
    data.cities[0].nights = 4; // 4+2=6 ≠ trip 5
    data.cities = deriveCityDates(data.trip.arrival_date, data.cities);
    const result = validateDraft(data);
    expect(result.ok).toBe(false);
    expect(result.nights.match).toBe(false);
    const mismatch = result.blocking.find((i) => i.invariant?.code === "nights_sum_mismatch");
    expect(mismatch?.stage).toBe("cities");
    expect(result.stages.cities).toBe("error");
  });

  it("BLOCKS on a hotel missing room type / board and attributes it to hotels", () => {
    const data = completeDraft();
    data.hotels[1] = { ...data.hotels[1], room_type_id: null, board_type: null };
    const result = validateDraft(data);
    expect(result.ok).toBe(false);
    const violation = result.blocking.find((i) => i.invariant?.code === "hotel_missing_room_or_board");
    expect(violation?.stage).toBe("hotels");
    expect(result.stages.hotels).toBe("error");
  });

  it("BLOCKS when a city has no hotel line", () => {
    const data = completeDraft();
    data.hotels = data.hotels.slice(0, 1);
    const result = validateDraft(data);
    expect(result.blocking.some((i) => i.key === "pg.err.missingHotels")).toBe(true);
  });

  it("BLOCKS on missing arrival date / country / adults (trip stage)", () => {
    const data = completeDraft();
    data.trip = { ...data.trip, arrival_date: null, country: "", adults: 0 };
    const result = validateDraft(data);
    const tripKeys = result.blocking.filter((i) => i.stage === "trip").map((i) => i.key);
    expect(tripKeys).toContain("pg.err.noArrival");
    expect(tripKeys).toContain("pg.err.noCountry");
    expect(tripKeys).toContain("pg.err.noAdults");
  });

  it("treats empty optional stages as warnings, not blockers", () => {
    const data = completeDraft();
    data.flights = [];
    data.pricing = { items: [], display_currency: "SAR", final_total: null };
    const result = validateDraft(data);
    expect(result.ok).toBe(true);
    const warnKeys = result.warnings.map((w) => w.key);
    expect(warnKeys).toContain("pg.warn.noFlights");
    expect(warnKeys).toContain("pg.warn.noPricing");
  });

  it("BLOCKS when a supplier-priced hotel's sell is edited below the supplier floor after pricing", () => {
    const data = completeDraft();
    data.hotels[0] = {
      ...data.hotels[0],
      sourcing: {
        supplier_id: "tbo", supplier_name: "TBO", rate_key: "RK1",
        net_base: 2500, net_source_currency: "USD", fx_rate: 3.75, fx_date: "2026-07-01",
        ref_sell_base: 3000, sell_base: 3500, markup_amount: 1000, markup_pct: 40,
        margin_pct: 28.57, min_margin_pct: 8, cancellation_policy: "x",
        excluded_surcharges: [], valid_until: null, room_category: "deluxe",
        room_name: "Deluxe Room", refundable: true, blocked: false, // priced fine at the time
        image_url: null, facilities: [], star_rating: 5,
        supplier_hotel_id: "H1", rate_fetched_at: null,
      },
    };
    const desc = `${data.hotels[0].city_name} — ${data.hotels[0].hotel_name}`;
    data.pricing.final_total = null;
    data.pricing.items = [
      { item_type: "hotel", description: desc, quantity: 1, buy_price: 2500, buy_currency: "SAR", sell_price: 3500, sell_currency: "SAR" },
    ];
    // priced at 3500 (≥ floor 3000) → no supplier block
    expect(validateDraft(data).blocking.some((i) => i.key === "pg.supplier.blocked")).toBe(false);

    // agent later lowers the sell to 2000 (< floor 3000) in the Pricing stage —
    // sourcing.blocked is STILL false, but the gate re-checks the effective sell.
    data.pricing.items[0].sell_price = 2000;
    const result = validateDraft(data);
    expect(result.ok).toBe(false);
    expect(result.blocking.some((i) => i.key === "pg.supplier.blocked")).toBe(true);
  });
});

describe("normalizeDraftData", () => {
  it("fills a partial/legacy payload with defaults", () => {
    const normalized = normalizeDraftData({ customer: { customer_name: "x" } });
    expect(normalized.customer.customer_name).toBe("x");
    expect(normalized.customer.customer_phone).toBe("");
    expect(normalized.cities).toEqual([]);
    expect(normalized.pricing.display_currency).toBe("SAR");
  });
});
