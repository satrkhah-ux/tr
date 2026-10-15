import { describe, it, expect } from "vitest";
import {
  deriveCityDates,
  emptyDraftData,
  normalizeDraftData,
  normalizeDraftHotel,
  withRooms,
  type DraftData,
} from "./draft-types";
import { citiesWithoutHotel, validateDraft } from "./draft-validation";
import { withRequiredAnswers } from "./draft-test-helpers";

function completeDraft(): DraftData {
  const data = emptyDraftData();
  data.customer = { ...data.customer, customer_name: "نايف الجهني", customer_phone: "0555555555" };
  data.trip = {
    ...data.trip,
    country: "ماليزيا",
    destination: "ماليزيا",
    arrival_date: "2026-06-01",
    departure_date: "2026-06-06",
    days: 6,
    nights: 5,
    adults: 2,
  };
  data.cities = deriveCityDates("2026-06-01", [
    { city_name: "كوالالمبور", nights: 3, check_in: null, check_out: null },
    { city_name: "لنكاوي", nights: 2, check_in: null, check_out: null },
  ]);
  data.hotels = [
    normalizeDraftHotel({ city_name: "كوالالمبور", hotel_id: "h1", hotel_name: "فندق 1", room_type_id: "rt1", room_type_name: "ديلوكس", board_type: "BB", rooms_count: 1 }),
    normalizeDraftHotel({ city_name: "لنكاوي", hotel_id: "h2", hotel_name: "فندق 2", room_type_id: "rt2", room_type_name: "سوبيريور", board_type: "HB", rooms_count: 1 }),
  ];
  data.flights = normalizeDraftData({
    flights: [
      { airline: "SV", flight_no: "SV832", from_airport: "RUH", to_airport: "KUL", departure_at: "2026-06-01T01:00", arrival_at: "2026-06-01T14:00", from_tz: "Asia/Riyadh", to_tz: "Asia/Kuala_Lumpur", date_user_set: false, cabin_class: "Y", baggage_allowance: "30kg", leg_order: "outbound" },
    ],
  }).flights;
  data.services = { includes: ["الفنادق"], excludes: [], terms: ["قابل للتعديل"] };
  data.pricing = {
    items: [{ item_type: "hotel", description: "فنادق", quantity: 1, buy_price: 1000, buy_currency: "SAR", sell_price: 1500, sell_currency: "SAR" }],
    display_currency: "SAR",
    final_total: 1500,
  };
  return withRequiredAnswers(data);
}

describe("a city split across two hotels", () => {
  /** كوالالمبور's 3 nights as 1 + 2, which is the whole point of the change. */
  function splitDraft(firstNights: number, secondNights: number): DraftData {
    const data = completeDraft();
    data.hotels = [
      normalizeDraftHotel({ city_name: "كوالالمبور", hotel_name: "فندق 1", nights: firstNights, room_type_name: "ديلوكس", board_type: "BB", rooms_count: 1 }),
      normalizeDraftHotel({ city_name: "كوالالمبور", hotel_name: "فندق 1ب", nights: secondNights, room_type_name: "ديلوكس", board_type: "BB", rooms_count: 1 }),
      normalizeDraftHotel({ city_name: "لنكاوي", hotel_name: "فندق 2", nights: 2, room_type_name: "سوبيريور", board_type: "HB", rooms_count: 1 }),
    ];
    return withRequiredAnswers(data);
  }

  it("publishes when the nights add up", () => {
    const result = validateDraft(splitDraft(1, 2));
    expect(result.blocking).toEqual([]);
    expect(result.stages.hotels).toBe("complete");
  });

  // The owner removed the «every night has a hotel» block (2026-10-12): a gap or
  // an overlap no longer stops the file, but the hotels card never reads complete.
  it("does not block a night without a bed, but leaves the hotels card incomplete", () => {
    const result = validateDraft(splitDraft(1, 1));
    expect(result.blocking.some((b) => b.stage === "hotels")).toBe(false);
    expect(result.stages.hotels).not.toBe("complete");
  });

  it("does not block over-allocation either, and still leaves the card incomplete", () => {
    const result = validateDraft(splitDraft(2, 2));
    expect(result.blocking.some((b) => b.stage === "hotels")).toBe(false);
    expect(result.stages.hotels).not.toBe("complete");
  });

  it("still accepts a single hotel with no nights of its own (every old draft)", () => {
    const result = validateDraft(completeDraft());
    expect(result.blocking).toEqual([]);
  });
});

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
    // through withRooms — the rooms array is the truth, the scalars only mirror it
    data.hotels[1] = withRooms(data.hotels[1], [{ room_type_id: null, room_type_name: "", board_type: null, price: null }]);
    const result = validateDraft(data);
    expect(result.ok).toBe(false);
    const violation = result.blocking.find((i) => i.invariant?.code === "hotel_missing_room_or_board");
    expect(violation?.stage).toBe("hotels");
    expect(result.stages.hotels).toBe("error");
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

  it("will not move past the flights card with no international flight, and only advises on pricing", () => {
    const data = completeDraft();
    data.flights = [];
    data.pricing = { items: [], display_currency: "SAR", final_total: null };
    const result = validateDraft(data);
    expect(result.blocking.some((i) => i.stage === "flights" && i.key === "pg.err.noIntlFlights")).toBe(true);
    expect(result.warnings.map((w) => w.key)).toContain("pg.warn.noPricing");
  });

  it("asks for one booking price per flight booking, and never for the supplier", () => {
    const data = completeDraft();
    data.flight_booking = { ...data.flight_booking, intl_price: null, intl_supplier: "" };
    data.hotels = data.hotels.map((h) => ({ ...h, supplier: "" }));
    const result = validateDraft(data);
    expect(result.blocking.map((i) => i.key)).toEqual(["pg.err.flightUnpriced"]);
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

/**
 * A file built for a partner company is a B2B sale: the partner keeps the client,
 * so asking us for the traveller's name and phone is asking for data we do not
 * have and are not entitled to.
 */
describe("a company file needs no client details", () => {
  function withoutClient(): DraftData {
    const data = completeDraft();
    data.customer = { ...data.customer, customer_name: "", customer_phone: "" };
    return data;
  }

  it("will not move past a DIRECT sale with no name or phone", () => {
    const result = validateDraft(withoutClient());
    expect(result.blocking.some((w) => w.key === "pg.warn.noName" && w.stage === "customer")).toBe(true);
    expect(result.blocking.some((w) => w.key === "pg.warn.noPhone" && w.stage === "customer")).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("stays silent once a partner company is chosen, and counts the stage done", () => {
    const data = withoutClient();
    data.customer = { ...data.customer, partner_company_id: "31ed6f37", company: "شركة الأفق" };
    const result = validateDraft(data);
    expect(result.blocking.some((w) => w.key === "pg.warn.noName")).toBe(false);
    expect(result.blocking.some((w) => w.key === "pg.warn.noPhone")).toBe(false);
    expect(result.stages.customer).toBe("complete");
    expect(result.ok).toBe(true);
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

describe("a planned international flight (flight_booking.estimate)", () => {
  function planned(over: Partial<DraftData["flights"][number]> = {}): DraftData {
    const data = completeDraft();
    data.flights = [{ ...data.flights[0], flight_no: "", airline: "", arrival_at: null, departure_at: "2026-06-01T00:00", ...over }];
    data.flight_booking = { ...data.flight_booking, estimate: true, intl_price: 3200 };
    return data;
  }
  const incomplete = (data: DraftData) => validateDraft(data).blocking.some((i) => i.key === "pg.err.flightIncomplete");

  it("is complete with its airports and its day — the tickets come later", () => {
    expect(incomplete(planned())).toBe(false);
  });

  it("still needs the day", () => {
    expect(incomplete(planned({ departure_at: null }))).toBe(true);
  });

  it("asks a leg whose number is in for the rest of the ticket", () => {
    expect(incomplete(planned({ flight_no: "SV832" }))).toBe(true);
  });

  it("is the old rule without the flag", () => {
    const data = planned();
    data.flight_booking = { ...data.flight_booking, estimate: undefined };
    expect(incomplete(data)).toBe(true);
  });
});

describe("two hotels in one city on dates of their own (order 1)", () => {
  /** كوالالمبور 1–4 June: فندق 1 for the city, a second hotel as the test says. */
  function withSecond(over: Partial<DraftData["hotels"][number]>): DraftData {
    const data = completeDraft();
    const second = normalizeDraftHotel({ city_name: "كوالالمبور", hotel_name: "فندق 1ب", room_type_name: "ديلوكس", board_type: "BB", rooms_count: 1, ...over });
    return withRequiredAnswers({ ...data, hotels: [data.hotels[0], second, data.hotels[1]] });
  }
  const outside = (d: DraftData) => validateDraft(d).blocking.some((b) => b.key === "pg.err.stayOutsideCity");

  it("publishes two hotels on the same dates — the rooms split, every night covered once", () => {
    const result = validateDraft(withSecond({ dates: "same" }));
    expect(result.blocking).toEqual([]);
    expect(result.stages.hotels).toBe("complete");
  });

  it("accepts a custom stay inside its city (acceptance ج)", () => {
    expect(outside(withSecond({ dates: "custom", check_in: "2026-06-02", nights: 2 }))).toBe(false);
    expect(validateDraft(withSecond({ dates: "custom", check_in: "2026-06-02", nights: 2 })).ok).toBe(true);
  });

  it("blocks a custom stay with a night outside its city, with its own message (acceptance ج)", () => {
    // كوالالمبور is 1–4 June: the 3rd for two nights runs into لنكاوي
    expect(outside(withSecond({ dates: "custom", check_in: "2026-06-03", nights: 2 }))).toBe(true);
    expect(outside(withSecond({ dates: "custom", check_in: "2026-05-31", nights: 1 }))).toBe(true);
    const issue = validateDraft(withSecond({ dates: "custom", check_in: "2026-06-03", nights: 2 })).blocking.find((b) => b.key === "pg.err.stayOutsideCity");
    expect(issue).toMatchObject({ severity: "blocking", stage: "hotels", field: "hotels" });
  });

  it("reads a same-dates stay with no stay before it as an ordinary one", () => {
    const data = completeDraft();
    const first = { ...data.hotels[0], dates: "same" as const };
    const result = validateDraft(withRequiredAnswers({ ...data, hotels: [first, data.hotels[1]] }));
    expect(result.blocking).toEqual([]);
    expect(result.stages.hotels).toBe("complete");
  });

  it("asks every stay for its own room, board and price", () => {
    const result = validateDraft(withSecond({ dates: "same", hotel_name: "فندق 1ب", rooms: [{ room_type_id: null, room_type_name: "", board_type: null, price: null }] }));
    expect(result.blocking.some((b) => b.invariant?.code === "hotel_missing_room_or_board")).toBe(true);
    const unpriced = withSecond({ dates: "same" });
    unpriced.hotels = unpriced.hotels.map((h, i) => (i === 1 ? withRooms(h, h.rooms.map((r) => ({ ...r, price: null }))) : h));
    expect(validateDraft(unpriced).blocking.some((b) => b.key === "pg.err.stayUnpriced")).toBe(true);
  });
});

describe("a tour day with no car (order 4)", () => {
  const withTour = (car: string, own?: string) => {
    const data = completeDraft();
    data.transport_plan = { ...data.transport_plan, tours: { ...data.transport_plan.tours, enabled: true, car_type: car } };
    data.cities = data.cities.map((c, i) =>
      i === 0 ? { ...c, tours: 1, tour_picks: [{ program_id: null, title: "جولة المدينة", text: "", price: 400, date: "2026-06-02", ...(own ? { car_type: own } : {}) }] } : c,
    );
    return validateDraft(data);
  };
  const warned = (r: ReturnType<typeof validateDraft>) => r.warnings.some((w) => w.key === "pg.warn.tourNoCar");

  it("warns, without blocking, while the tours have their transport", () => {
    const result = withTour("");
    expect(warned(result)).toBe(true);
    expect(result.blocking.some((b) => b.key === "pg.warn.tourNoCar")).toBe(false);
  });

  it("is quiet once the tour has a car — its own or the trip's — or the tours have no transport", () => {
    expect(warned(withTour("فان"))).toBe(false);
    expect(warned(withTour("", "سيدان"))).toBe(false);
    const off = completeDraft();
    off.transport_plan = { ...off.transport_plan, tours: { ...off.transport_plan.tours, enabled: false, car_type: "" } };
    off.cities = off.cities.map((c, i) => (i === 0 ? { ...c, tours: 1, tour_picks: [{ program_id: null, title: "جولة", text: "", price: 1 }] } : c));
    expect(warned(validateDraft(off))).toBe(false);
  });
});

describe("a city with nights and no hotel is never issued (AD-4-8573)", () => {
  // the real file: rooms, boards and prices typed, the hotel's name never chosen
  const hotelless = () => {
    const data = completeDraft();
    data.hotels = data.hotels.map((h) => ({ ...h, hotel_id: null, hotel_name: "" }));
    return data;
  };
  const gate = (r: ReturnType<typeof validateDraft>) => r.blocking.some((b) => b.key === "pg.err.cityNoHotel");

  it("blocks the issue and names both cities — the list Basic focuses is the server's", () => {
    const data = hotelless();
    expect(citiesWithoutHotel(data)).toEqual(["كوالالمبور", "لنكاوي"]);
    const result = validateDraft(data);
    expect(result.ok).toBe(false);
    expect(gate(result)).toBe(true);
  });

  it("blocks one city left without a hotel even when the other has one", () => {
    const data = completeDraft();
    data.hotels = [data.hotels[0]];
    expect(citiesWithoutHotel(data)).toEqual(["لنكاوي"]);
    expect(gate(validateDraft(data))).toBe(true);
  });

  it("blocks a second stay left without its hotel's name — the document would print «—»", () => {
    const data = completeDraft();
    data.hotels = [...data.hotels, { ...data.hotels[1], id: "extra", hotel_id: null, hotel_name: "", dates: "same" }];
    expect(citiesWithoutHotel(data)).toEqual(["لنكاوي"]);
  });

  it("only advises a partner's own file — its own rules", () => {
    const result = validateDraft(hotelless(), { partnerFile: true });
    expect(gate(result)).toBe(false);
    expect(result.warnings.some((w) => w.key === "pg.err.cityNoHotel")).toBe(true);
  });

  it("never stops a ready-made package (locked price) or a sale without hotels", () => {
    const fixed = hotelless();
    fixed.source = { ready_offer_id: "ro1", code: "P1", tier: "", title: "باقة", valid_from: null, valid_to: null };
    fixed.pricing = { ...fixed.pricing, final_total: 5000 };
    expect(citiesWithoutHotel(fixed)).toEqual([]);
    const noHotels = hotelless();
    noHotels.scope = { ...noHotels.scope, hotels: false };
    expect(gate(validateDraft(noHotels))).toBe(false);
  });

  it("passes once every city names a hotel", () => {
    expect(gate(validateDraft(completeDraft()))).toBe(false);
  });
});
