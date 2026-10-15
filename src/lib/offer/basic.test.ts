import { describe, expect, it } from "vitest";
import {
  addStay,
  cityHotelLines,
  deriveHotelStays,
  deriveTransportRows,
  emptyDraftData,
  emptyFlight,
  hotelCoverage,
  normalizeDraftData,
  withRooms,
  type DraftData,
  type LookupAirport,
  type TourPick,
  type DraftPricingItem,
} from "./draft-types";
import { findTourPrice, suggestPricing, type PricingReference } from "./pricing-suggest";
import { domesticMismatches } from "./flight-cities";
import { applyManualProfit } from "./pricing";
import {
  addCity,
  baseRoomName,
  basicDays,
  changeRoom,
  cityLines,
  clearRoomChange,
  EXTRA_BED,
  extraBeds,
  priceAtSource,
  carForGroup,
  packageProfitFor,
  resizeGroupCars,
  withGroupCars,
  rankAirports,
  roomSuggestions,
  STANDARD_ROOMS,
  withDomesticFlights,
  withPackageProfit,
  typedSheetPrice,
  withScopeLines,
  priceGroupOf,
  planInternational,
  remainingNights,
  removeCity,
  renameRooms,
  setCityNights,
  withExtraBeds,
  withHotelLines,
  withTripDates,
  WELCOME,
  withTourCount,
  withTours,
  type BasicCity,
} from "./basic";

/** The video's file: Malaysia from 11 Nov, 8 nights, three cities. */
function malaysia(): DraftData {
  let data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-11-11", nights: 8, days: 9, meal_plan: "breakfast" };
  data.flights = [];
  for (const [name, nights, tours] of [
    ["سيلانغور", 2, 1],
    ["لنكاوي", 3, 2],
    ["كوالالمبور", 3, 1],
  ] as const) {
    data = { ...data, ...addCity(data, { name, nights, tours }, "MYR") };
  }
  return data;
}

describe("النظام بيسك", () => {
  it("chains each city from where the previous one ends, with a hotel line born for it", () => {
    const data = malaysia();
    expect(data.cities.map((c) => [c.city_name, c.check_in, c.check_out])).toEqual([
      ["سيلانغور", "2026-11-11", "2026-11-13"],
      ["لنكاوي", "2026-11-13", "2026-11-16"],
      ["كوالالمبور", "2026-11-16", "2026-11-19"],
    ]);
    expect(data.hotels.map((h) => [h.city_name, h.board_type, h.manual_currency])).toEqual([
      ["سيلانغور", "BB", "MYR"],
      ["لنكاوي", "BB", "MYR"],
      ["كوالالمبور", "BB", "MYR"],
    ]);
    expect(remainingNights(data)).toBe(0);
  });

  it("writes the programme from the cities and their tours", () => {
    const titles = basicDays(malaysia()).map((d) => d.title);
    expect(titles).toEqual([
      "الوصول إلى سيلانغور",
      "جولة سياحية في سيلانغور",
      "الانتقال إلى لنكاوي",
      "جولة سياحية في لنكاوي",
      "جولة سياحية في لنكاوي",
      "الانتقال إلى كوالالمبور",
      "جولة سياحية في كوالالمبور",
      "يوم حر",
      "المغادرة",
    ]);
  });

  it("never rewrites a title the agent typed", () => {
    const data = malaysia();
    data.days = basicDays(data).map((d, i) => (i === 1 ? { ...d, title: "زيارة جزيرة القرود" } : d));
    expect(basicDays(data)[1].title).toBe("زيارة جزيرة القرود");
  });

  it("keeps a room's nightly price when its city's nights change", () => {
    const data = malaysia();
    data.hotels = data.hotels.map((h, i) => (i === 0 ? { ...h, rooms: h.rooms.map((r) => ({ ...r, price: 750 })) } : h));
    const next = setCityNights(data, 0, 3);
    expect(next.hotels[0].rooms[0].price).toBe(1125);
    expect(next.cities[1].check_in).toBe("2026-11-14");
    expect((next.cities[0] as BasicCity).tours).toBe(1);
  });

  it("splits a stay for a room change, each half at the same nightly rate, and joins it back", () => {
    const data = malaysia();
    // لنكاوي: 3 nights, 900 for the stay = 300 a night
    data.hotels = data.hotels.map((h) => (h.city_name === "لنكاوي" ? { ...h, rooms: h.rooms.map((r) => ({ ...r, price: 900 })) } : h));
    const split = { ...data, ...changeRoom(data, 1, 1, "جناح") };
    const [first, second] = cityLines(split.hotels, "لنكاوي");
    expect([first.nights, first.rooms[0].price]).toEqual([1, 300]);
    expect([second.nights, second.rooms[0].room_type_name, second.rooms[0].price]).toEqual([0, "جناح", null]);
    expect(split.hotels.map((h) => h.city_name)).toEqual(["سيلانغور", "لنكاوي", "لنكاوي", "كوالالمبور"]);

    const joined = clearRoomChange(split, 1).hotels;
    expect(cityLines(joined, "لنكاوي").map((h) => [h.nights, h.rooms[0].price])).toEqual([[0, 900]]);

    // a city cut to one night has no room left to change into
    expect(cityLines(setCityNights(split, 1, 1).hotels, "لنكاوي")).toHaveLength(1);
  });

  it("puts the extra bed on the first rooms and keeps it through a rename", () => {
    let line = malaysia().hotels[0];
    line = withRooms(line, [...line.rooms, { ...line.rooms[0] }]);
    line = renameRooms(withExtraBeds(line, 1), "ديلوكس");
    expect(line.rooms.map((r) => r.room_type_name)).toEqual([`ديلوكس${EXTRA_BED}`, "ديلوكس"]);
    expect([extraBeds(line), baseRoomName(line.rooms[0].room_type_name)]).toEqual([1, "ديلوكس"]);
  });

  it("reads the nights from a departure date, and moves the departure with the nights", () => {
    const trip = malaysia().trip;
    expect(withTripDates(trip, { departure_date: "2026-11-21" })).toMatchObject({ nights: 10, days: 11 });
    expect(withTripDates(trip, { nights: 5 })).toMatchObject({ departure_date: "2026-11-16", days: 6 });
  });

  it("adds nights to the last city when the same city is added again, instead of a row moving into itself", () => {
    const data = malaysia();
    data.hotels = data.hotels.map((h) => (h.city_name === "كوالالمبور" ? { ...h, rooms: h.rooms.map((r) => ({ ...r, price: 900 })) } : h));
    const next = { ...data, ...addCity(data, { name: "كوالالمبور", nights: 2, tours: 1 }, "SAR") };
    expect(next.cities.map((c) => [c.city_name, c.nights, (c as BasicCity).tours])).toEqual([
      ["سيلانغور", 2, 1],
      ["لنكاوي", 3, 2],
      ["كوالالمبور", 5, 2],
    ]);
    // one hotel line, its 3-night total grown to 5 nights at the same rate
    expect(cityLines(next.hotels, "كوالالمبور").map((h) => h.rooms[0].price)).toEqual([1500]);
  });

  it("adds a city with the hotel, room and room count picked on the bar", () => {
    const data = malaysia();
    const next = addCity(data, { name: "بينانج", nights: 2, tours: 0, hotel: { id: "h-1", name: "شانغريلا بينانج" }, room: "ديلوكس", rooms: 2 }, "SAR");
    const [line] = cityLines(next.hotels, "بينانج");
    expect([line.hotel_id, line.hotel_name, line.rooms.length, line.rooms.map((r) => r.room_type_name)]).toEqual([
      "h-1",
      "شانغريلا بينانج",
      2,
      ["ديلوكس", "ديلوكس"],
    ]);
  });

  it("writes the welcome, a domestic flight's day, and the picked tours", () => {
    const data = malaysia();
    const plan = data.transport_plan;
    data.transport_plan = { ...plan, intercity: { ...plan.intercity, enabled: true, modes: ["car", "flight"], hop_modes: { "سيلانغور>لنكاوي": "flight" } } };
    data.flights = [{ ...emptyFlight("internal"), to_city: "لنكاوي", flight_no: "AK6302" }];
    data.cities = data.cities.map((c, i) =>
      i === 1 ? { ...c, tour_picks: withTourCount([{ program_id: "p1", title: "جزيرة الحامل", text: "رحلة بحرية", price: 400 }], 2) } : c,
    );
    const days = basicDays(data);
    expect(days[0].activities).toEqual([WELCOME]);
    expect(days[2].title).toBe("السفر إلى لنكاوي");
    expect(days[2].activities[1]).toBe("السفر إلى لنكاوي على الطيران الداخلي (AK6302)");
    expect([days[3].title, days[3].activities]).toEqual(["جزيرة الحامل", ["رحلة بحرية"]]);
    expect(days[4].title).toBe("جولة سياحية في لنكاوي");
    // the road hop to KL keeps its own wording
    expect(days[5].activities[1]).toBe("الانتقال براً إلى كوالالمبور والتوجه إلى الفندق");

    // a title changed by hand is the agent's from then on
    const edited = days.map((d, i) => (i === 3 ? { ...d, title: "يوم على الشاطئ" } : d));
    expect(basicDays({ ...data, days: edited })[3].title).toBe("يوم على الشاطئ");
  });

  it("lets a city take more tours than it has days — the arrival day next, then they share", () => {
    const data = malaysia();
    // كوالالمبور: 16–18 Nov, 4 tours asked: the 17th and 18th, then the 16th (the move day), then the 17th again
    data.cities = data.cities.map((c, i) => (i === 2 ? { ...c, tours: 4, tour_picks: withTourCount([], 4) } : c));
    const days = basicDays(data);
    expect(days[5].activities.at(-1)).toBe("جولة سياحية في كوالالمبور");
    expect([days[6].title, days[6].activities]).toEqual(["جولة سياحية في كوالالمبور", ["جولة سياحية في كوالالمبور"]]);
    expect(days[7].title).toBe("جولة سياحية في كوالالمبور");
    expect(days[8].title).toBe("المغادرة");
  });

  it("puts a dated tour on its own day, keeps «يوم حر» free, and names the car", () => {
    const data = malaysia();
    // لنكاوي: 13–16 Nov — the tour asked for the 15th, a free day on the 14th
    data.cities = data.cities.map((c, i) =>
      i === 1
        ? {
            ...c,
            tours: 2,
            tour_picks: [
              { program_id: null, title: "يوم حر", text: "", price: 0, date: "2026-11-14", free: true },
              { program_id: "p1", title: "جزيرة الحامل", text: "رحلة بحرية", price: 400, date: "2026-11-15", car_type: "فان" },
            ],
          }
        : c,
    );
    const days = basicDays(data);
    const on = (date: string) => days.find((d) => d.date === date)!;
    expect(on("2026-11-14").title).toBe("يوم حر");
    expect([on("2026-11-15").title, on("2026-11-15").activities]).toEqual(["جزيرة الحامل", ["رحلة بحرية", "التنقل بـفان"]]);
  });

  it("sorts the pricing lines into their groups — a tour is a service the city card wrote", () => {
    expect(
      [
        { item_type: "hotel" as const },
        { item_type: "flight" as const },
        { item_type: "transport" as const },
        { item_type: "service" as const, ref: "tour:لنكاوي:0" },
        { item_type: "service" as const, ref: "service:شريحة" },
        { item_type: "visa" as const },
        { item_type: "other" as const },
      ].map(priceGroupOf),
    ).toEqual(["hotels", "flights", "transport", "tours", "services", "visas", "other"]);
  });

  it("books the bar's price on every room of the new city", () => {
    const next = addCity(malaysia(), { name: "بينانج", nights: 2, tours: 0, room: "ديلوكس", rooms: 2, price: 900 }, "SAR");
    expect(cityLines(next.hotels, "بينانج")[0].rooms.map((r) => r.price)).toEqual([900, 900]);
  });

  it("leaves every day free when tours are switched off", () => {
    const data = malaysia();
    data.transport_plan = { ...data.transport_plan, tours: { ...data.transport_plan.tours, enabled: false } };
    expect(basicDays(data).filter((d) => d.title.startsWith("جولة"))).toHaveLength(0);
  });

  it("keeps a neighbour's country on its city, and gives a flown-in city its hotel line", () => {
    const data = malaysia();
    const next = { ...data, ...addCity(data, { name: "سنغافورة", nights: 2, tours: 0, country: "سنغافورة" }, "SAR") };
    expect([next.cities[3].country, next.cities[0].country]).toEqual(["سنغافورة", undefined]);
    const flown = { ...data, cities: [...data.cities, { city_name: "جوهور", nights: 1, check_in: null, check_out: null }] };
    expect(withHotelLines(flown, "SAR").map((h) => h.city_name)).toContain("جوهور");
  });

  it("plans the international flight as legs: out, home the other way, the domestic kept", () => {
    const data = malaysia();
    data.flights = [{ ...emptyFlight("internal"), from_city: "كوالالمبور", to_city: "لنكاوي", flight_no: "AK6302" }];
    const airports = [
      { id: "1", name: "مطار الملك خالد الدولي", code: "RUH", timezone: "Asia/Riyadh", city: "الرياض", status: null },
      { id: "2", name: "مطار كوالالمبور الدولي", code: "KUL", timezone: "Asia/Kuala_Lumpur", city: "كوالالمبور", status: null },
    ] as unknown as Parameters<typeof planInternational>[1];
    const plan = { from: "مطار الملك خالد الدولي (RUH)", to: "مطار كوالالمبور الدولي (KUL)", go: "2026-11-11", back: "2026-11-21", round: true };
    const next = planInternational(data, airports, plan);
    expect(next.flights.map((f) => [f.leg_order, f.from_city, f.to_city, f.departure_at, f.date_user_set])).toEqual([
      ["outbound", "الرياض", "كوالالمبور", "2026-11-11T00:00", false],
      ["inbound", "كوالالمبور", "الرياض", "2026-11-21T00:00", true],
      ["internal", "كوالالمبور", "لنكاوي", null, false],
    ]);
    expect([next.flights[0].to_tz, next.flight_booking.estimate, next.flight_booking.mode]).toEqual(["Asia/Kuala_Lumpur", true, "round"]);
    // one way: no way home
    expect(planInternational(data, airports, { ...plan, round: false }).flights.map((f) => f.leg_order)).toEqual(["outbound", "internal"]);
  });

  it("writes each tour's day: after the arrival first, a day the city lost handed out again", () => {
    // لنكاوي: 13–16 Nov — tours go on the 14th and 15th, a third on the arrival day, a fourth shares the 14th — in date order
    const lnk = malaysia().cities[1];
    expect(withTours(lnk, 2).map((p) => p.date)).toEqual(["2026-11-14", "2026-11-15"]);
    expect(withTours(lnk, 4).map((p) => p.date)).toEqual(["2026-11-13", "2026-11-14", "2026-11-14", "2026-11-15"]);
    const moved = { ...lnk, tour_picks: [{ program_id: null, title: "x", text: "", price: null, date: "2026-12-01" }] };
    expect(withTours(moved, 1)[0].date).toBe("2026-11-14");
  });

  it("puts a price changed on the sheet back where it was typed", () => {
    const data = malaysia();
    data.hotels = data.hotels.map((h, i) => (i === 0 ? withRooms(h, [{ ...h.rooms[0], price: 300 }, { ...h.rooms[0], price: 100 }]) : h));
    const line = data.hotels[0];
    // the rooms keep their shares of the new total
    const hotels = priceAtSource(data, { item_type: "hotel", ref: line.id }, { price: 800, currency: "USD" })!.hotels!;
    expect([hotels[0].rooms.map((r) => r.price), hotels[0].manual_currency]).toEqual([[600, 200], "USD"]);
    data.cities = data.cities.map((c, i) => (i === 1 ? { ...c, tour_picks: withTours(c, 2) } : c));
    const cities = priceAtSource(data, { item_type: "service", ref: "tour:لنكاوي:1" }, { price: 450 })!.cities!;
    expect(cities[1].tour_picks?.map((p) => p.price)).toEqual([null, 450]);
    expect(priceAtSource(data, { item_type: "flight", ref: "flight:intl" }, { price: 5200 })!.flight_booking!.intl_price).toBe(5200);
    // a transfer priced from the list has no place to go back to
    expect(priceAtSource(data, { item_type: "transport", ref: "transport:a>b>van" }, { price: 90 })).toBeNull();
  });

  it("a total typed on the sheet turns a «للفرد» flight into «إجمالي» at that figure", () => {
    const data = malaysia();
    const perPerson = { price_mode: "per_person", adult_price: 1500, child_price: null, infant_price: null } as const;
    data.flight_booking = { ...data.flight_booking, intl_price: 3000, intl_fare: perPerson, dom_price: 400, dom_fare: { ...perPerson, adult_price: 200 } };
    const intl = priceAtSource(data, { item_type: "flight", ref: "flight:intl" }, { price: 5200 })!.flight_booking!;
    expect([intl.intl_fare.price_mode, intl.intl_price, intl.intl_fare.adult_price]).toEqual(["total", 5200, 1500]);
    // the other booking is not touched
    expect(intl.dom_fare.price_mode).toBe("per_person");
    // a currency alone is not a new total: the tickets still decide it
    const dom = priceAtSource(data, { item_type: "flight", ref: "flight:dom" }, { currency: "USD" })!.flight_booking!;
    expect([dom.dom_fare.price_mode, dom.dom_price, dom.dom_currency]).toEqual(["per_person", 400, "USD"]);
  });

  const AIRPORTS: LookupAirport[] = [
    { id: "1", name: "مطار كوالالمبور الدولي", code: "KUL", timezone: "Asia/Kuala_Lumpur", city: "كوالالمبور", country: "ماليزيا" },
    { id: "2", name: "مطار لنكاوي الدولي", code: "LGK", timezone: "Asia/Kuala_Lumpur", city: "لنكاوي", country: "ماليزيا" },
    { id: "3", name: "مطار الأمير محمد بن عبدالعزيز", code: "MED", timezone: "Asia/Riyadh", city: "المدينة المنورة", country: "السعوديه" },
    { id: "4", name: "مطار الملك خالد الدولي", code: "RUH", timezone: "Asia/Riyadh", city: "الرياض", country: "السعوديه" },
    { id: "5", name: "مطار دبي الدولي", code: "DXB", timezone: "Asia/Dubai", city: "دبي", country: "الإمارات" },
  ];

  it("lists Madinah then the Kingdom first for a departure, the package's country first for an arrival", () => {
    expect(rankAirports(AIRPORTS, "home").map((a) => a.code)).toEqual(["MED", "RUH", "KUL", "LGK", "DXB"]);
    expect(rankAirports(AIRPORTS, ["ماليزيا"]).map((a) => a.code)).toEqual(["KUL", "LGK", "MED", "RUH", "DXB"]);
    // the package's own cities before the rest of its country
    expect(rankAirports(AIRPORTS, ["ماليزيا"], ["لنكاوي"]).map((a) => a.code)).toEqual(["LGK", "KUL", "MED", "RUH", "DXB"]);
  });

  it("writes the domestic flights the cities call for — out to Langkawi and back the other way", () => {
    let data = emptyDraftData();
    data.trip = { ...data.trip, country: "ماليزيا", arrival_date: "2026-11-11", nights: 5, meal_plan: "breakfast" };
    data.transport_plan = { ...data.transport_plan, intercity: { ...data.transport_plan.intercity, modes: ["car", "flight"], mode: "car" } };
    data = {
      ...data,
      ...planInternational(data, AIRPORTS, { from: "مطار الأمير محمد بن عبدالعزيز (MED)", to: "مطار كوالالمبور الدولي (KUL)", go: "2026-11-11", back: "2026-11-16", round: true }),
    };
    data = { ...data, ...addCity(data, { name: "لنكاوي", nights: 5, tours: 0 }, "SAR") };
    const next = { ...data, ...withDomesticFlights(data, AIRPORTS) };
    const dom = next.flights.filter((f) => f.leg_order === "internal");
    expect(dom.map((f) => [f.from_airport, f.to_airport, f.departure_at, f.auto])).toEqual([
      ["مطار كوالالمبور الدولي (KUL)", "مطار لنكاوي الدولي (LGK)", "2026-11-11T00:00", true],
      ["مطار لنكاوي الدولي (LGK)", "مطار كوالالمبور الدولي (KUL)", "2026-11-16T00:00", true],
    ]);
    // the programme agrees with the booking
    expect(domesticMismatches(next.flights, next.cities)).toEqual([]);
    // by road into Langkawi: that leg goes, the way back stays
    const road = { ...next, transport_plan: { ...next.transport_plan, intercity: { ...next.transport_plan.intercity, hop_modes: { ...next.transport_plan.intercity.hop_modes, "كوالالمبور>لنكاوي": "car" as const } } } };
    expect(withDomesticFlights(road, AIRPORTS).flights.filter((f) => f.leg_order === "internal").map((f) => f.to_city)).toEqual(["كوالالمبور"]);
    // a leg the agent ticketed is kept even when its move is gone
    const ticketed = { ...next, flights: next.flights.map((f) => (f.to_city === "لنكاوي" ? { ...f, flight_no: "MH1432" } : f)), cities: [] };
    expect(withDomesticFlights({ ...ticketed, cities: next.cities.map((c) => ({ ...c, city_name: "بينانج" })) }, AIRPORTS).flights.some((f) => f.flight_no === "MH1432")).toBe(true);
  });

  it("keeps «يشمل» in step with the file: the flight booked is included, the meal said once", () => {
    const data = malaysia();
    data.scope = { ...data.scope, flights_intl: true, transport: true };
    data.services = { ...data.services, includes: ["الفنادق", "وجبة الإفطار", "الطيران الداخلي", "خدمة عملاء 24 ساعة بالعربي"], excludes: ["الطيران الدولي", "وجبة الغداء والعشاء"] };
    const s = withScopeLines(data);
    expect(s.includes).toEqual(["الفنادق", "خدمة عملاء 24 ساعة بالعربي", "الطيران الدولي", "الجولات السياحية", "الإستقبال والتوديع من المطار إلى الفندق والعكس"]);
    expect(s.excludes).toEqual(["وجبة الغداء والعشاء"]);
  });

  it("promises nothing the scope switched off: no reception, no tours, no domestic flight (the partner trial)", () => {
    const data = malaysia();
    data.scope = { ...data.scope, transport: false, flights_domestic: false };
    data.transport_plan = { ...data.transport_plan, tours: { ...data.transport_plan.tours, enabled: false } };
    data.services = { ...data.services, includes: ["الفنادق", "الإستقبال والتوديع من المطار إلى الفندق والعكس", "الجولات السياحية", "الطيران الداخلي"], excludes: [] };
    const s = withScopeLines(data);
    expect(s.includes).not.toContain("الإستقبال والتوديع من المطار إلى الفندق والعكس");
    expect(s.includes).not.toContain("الجولات السياحية");
    expect(s.includes).not.toContain("الطيران الداخلي");
    expect(s.includes).toContain("الفنادق");
  });

  it("lays the package profit over the lines: a margin on each, an amount shared by cost", () => {
    const line = (buy: number, currency: string) => ({ item_type: "hotel" as const, description: "", quantity: 1, buy_price: buy, buy_currency: currency, sell_price: buy, sell_currency: currency });
    const items = [line(3000, "SAR"), line(1000, "MYR")];
    const rates = { SAR: 1, MYR: 1 };
    expect(withPackageProfit(items, { mode: "pct", value: 10 }, rates, "SAR").map((i) => i.profit_pct)).toEqual([10, 10]);
    // 1000 SAR over 3000 + 1000 of cost: 750 and 250
    expect(withPackageProfit(items, { mode: "amount", value: 1000 }, rates, "SAR").map((i) => i.profit_amount)).toEqual([750, 250]);
    expect(withPackageProfit(items, undefined, rates, "SAR")).toBe(items);
    // three equal lines: the cent the rounding lost goes back — the amount is the amount
    const three = withPackageProfit([line(100, "SAR"), line(100, "SAR"), line(100, "SAR")], { mode: "amount", value: 1000 }, rates, "SAR");
    expect(three.reduce((sum, i) => sum + (i.profit_amount ?? 0), 0)).toBeCloseTo(1000, 6);
  });

  it("suggests the chosen hotel's own rooms first, by category, then the clear names — never another hotel's", () => {
    const types = [
      { id: "a", name: "جناح ديلوكس", hotel_id: "h1", default_board: null },
      { id: "c", name: "Superior Twin", hotel_id: "h1", default_board: null },
      { id: "b", name: "سويت المحيط", hotel_id: "h2", default_board: null },
      { id: "g", name: "بانوراما", hotel_id: null, default_board: null },
    ];
    expect(roomSuggestions(types, "h1")).toEqual(["Superior Twin", "جناح ديلوكس", ...STANDARD_ROOMS]);
    expect(roomSuggestions(types, null)).toEqual(STANDARD_ROOMS);
    // the full generator keeps the shared list after them
    expect(roomSuggestions(types, "h1", true)).toEqual(["Superior Twin", "جناح ديلوكس", ...STANDARD_ROOMS, "بانوراما"]);
  });

  it("seats a group by the seats a car's name states when its column is empty", () => {
    const fleet = [
      { name: "سيارة صغيرة", pax: 3 },
      { name: "باص 40 راكب", pax: null },
    ];
    expect(carForGroup(fleet, 20)).toEqual({ car_type: "باص 40 راكب", cars: 1 });
  });

  it("starts a file on the default margin only when nobody stated a profit", () => {
    const item = { item_type: "hotel" as const, description: "", quantity: 1, buy_price: 100, buy_currency: "SAR", sell_price: 100, sell_currency: "SAR" };
    expect(packageProfitFor({ items: [item] }, 12)).toEqual({ mode: "pct", value: 12 });
    expect(packageProfitFor({ items: [item], profit: { mode: "amount", value: 500 } }, 12)).toEqual({ mode: "amount", value: 500 });
    // a line priced with its own profit (the full generator) is not overridden
    expect(packageProfitFor({ items: [{ ...item, profit_pct: 5 }] }, 12)).toBeUndefined();
    expect(packageProfitFor({ items: [item] }, null)).toBeUndefined();
  });

  const FLEET = [
    { name: "سيارة صغيرة", pax: 2 },
    { name: "ليموزين / VIP", pax: 3 },
    { name: "سيارة متوسطة", pax: 4 },
    { name: "ميني فان", pax: 5 },
    { name: "فان مرسيدس", pax: 8 },
  ];

  it("seats the group in the smallest ordinary car — a seat to spare from three people, never a limousine", () => {
    expect(carForGroup(FLEET, 2)).toEqual({ car_type: "سيارة صغيرة", cars: 1 });
    expect(carForGroup(FLEET, 3)).toEqual({ car_type: "سيارة متوسطة", cars: 1 });
    expect(carForGroup(FLEET, 4)).toEqual({ car_type: "ميني فان", cars: 1 });
    expect(carForGroup(FLEET, 12)).toEqual({ car_type: "فان مرسيدس", cars: 2 });
  });

  it("fills only the cars still empty, and moves only the ones that were the group's size", () => {
    const plan = malaysia().transport_plan;
    const chosen = { ...plan, tours: { ...plan.tours, car_type: "فان مرسيدس", cars: 1 } };
    const filled = withGroupCars(chosen, { car_type: "ميني فان", cars: 1 });
    expect([filled.airport.car_type, filled.tours.car_type]).toEqual(["ميني فان", "فان مرسيدس"]);
    const grown = resizeGroupCars(filled, { car_type: "ميني فان", cars: 1 }, { car_type: "فان مرسيدس", cars: 1 });
    expect(grown.airport.car_type).toBe("فان مرسيدس");
  });

  it("finds a tour on the price list however its name was spelled", () => {
    const list = [{ name: "جولة جزيرة الحامل", price: 180, currency: "SAR" }];
    expect(findTourPrice(list, "جوله جزيره الحامل")?.price).toBe(180);
    expect(findTourPrice(list, "جولة أخرى")).toBeNull();
  });

  it("prices the transfers either side of a domestic flight, not the flight as a road", () => {
    const data = malaysia();
    const plan = { ...data.transport_plan, airport: { ...data.transport_plan.airport, car_type: "ميني فان" }, intercity: { ...data.transport_plan.intercity, enabled: true, modes: ["car", "flight"] as ("car" | "flight")[], hop_modes: { "لنكاوي>كوالالمبور": "flight" as const } } };
    const rows = deriveTransportRows(plan, data.cities).map((r) => `${r.from_place} ← ${r.to_place}`);
    expect(rows).toContain("فندق لنكاوي ← المطار");
    expect(rows).toContain("المطار ← فندق كوالالمبور");
    expect(rows).not.toContain("لنكاوي ← كوالالمبور");
  });
});

describe("النظام بيسك — more than one hotel in a city (order 1)", () => {
  /** كوالالمبور 4 nights, then لنكاوي 3, then كوالالمبور again for 1. */
  function loop(): DraftData {
    let data = emptyDraftData();
    data.trip = { ...data.trip, country: "ماليزيا", arrival_date: "2026-11-11", nights: 8, days: 9, meal_plan: "breakfast" };
    data.flights = [];
    for (const [name, nights, hotel] of [
      ["كوالالمبور", 4, "بولمان"],
      ["لنكاوي", 3, "بيرجايا"],
      ["كوالالمبور", 1, "سما سما"],
    ] as const) {
      data = { ...data, ...addCity(data, { name, nights, tours: 0, hotel: { id: hotel, name: hotel } }, "SAR") };
    }
    return data;
  }
  const stopHotels = (data: DraftData, i: number) => cityHotelLines(data.cities, data.hotels, i).map((h) => h.hotel_name);

  it("gives the second visit of a city its own hotel line (acceptance د)", () => {
    const data = loop();
    expect(data.cities.map((c) => c.key)).toEqual(["كوالالمبور#1", "لنكاوي#1", "كوالالمبور#2"]);
    expect([stopHotels(data, 0), stopHotels(data, 1), stopHotels(data, 2)]).toEqual([["بولمان"], ["بيرجايا"], ["سما سما"]]);
    expect(deriveHotelStays(data.cities, data.hotels).map((s) => [s.line.hotel_name, s.check_in, s.check_out])).toEqual([
      ["بولمان", "2026-11-11", "2026-11-15"],
      ["بيرجايا", "2026-11-15", "2026-11-18"],
      ["سما سما", "2026-11-18", "2026-11-19"],
    ]);
    // removing the last visit takes its hotel only
    const gone = removeCity(data, 2);
    expect(gone.hotels.map((h) => h.hotel_name)).toEqual(["بولمان", "بيرجايا"]);
    // a visit the flights made gets a line of its own too
    const flown = { ...data, hotels: data.hotels.filter((h) => h.hotel_name !== "سما سما") };
    const lines = withHotelLines(flown, "SAR");
    expect(lines.at(-1)).toMatchObject({ city_name: "كوالالمبور", city_key: "كوالالمبور#2" });
  });

  it("moves a same-dates hotel with the stay it follows when the city's nights change", () => {
    const data = loop();
    const both = { ...data, hotels: addStay(data.cities, data.hotels, 0, "same").hotels };
    const next = { ...both, ...setCityNights(both, 0, 5) };
    expect(deriveHotelStays(next.cities, next.hotels).filter((s) => s.city_index === 0).map((s) => [s.check_in, s.check_out])).toEqual([
      ["2026-11-11", "2026-11-16"],
      ["2026-11-11", "2026-11-16"],
    ]);
    expect(hotelCoverage(next.cities, next.hotels)[0]).toMatchObject({ needed: 5, covered: 5, extra: 0 });
  });

  it("keeps the room change working beside another hotel in the same city", () => {
    const data = loop();
    // بولمان 2 nights, then another hotel after it
    const two = { ...data, hotels: data.hotels.map((h) => (h.hotel_name === "بولمان" ? { ...h, nights: 2 } : h)) };
    const other = addStay(two.cities, two.hotels, 0, "after");
    const withOther = {
      ...two,
      hotels: other.hotels.map((h) => (h.id === other.id ? { ...h, hotel_id: "تريدرز", hotel_name: "تريدرز" } : h)),
    };
    const split = { ...withOther, ...changeRoom(withOther, 0, 1, "جناح") };
    expect(stopHotels(split, 0)).toEqual(["بولمان", "بولمان", "تريدرز"]);
    expect(deriveHotelStays(split.cities, split.hotels).filter((s) => s.city_index === 0).map((s) => [s.line.hotel_name, s.nights])).toEqual([
      ["بولمان", 1],
      ["بولمان", 1],
      ["تريدرز", 2],
    ]);
    // undoing it takes the room change only — the other hotel stays
    expect(cityHotelLines(split.cities, clearRoomChange(split, 0).hotels, 0).map((h) => h.hotel_name)).toEqual(["بولمان", "تريدرز"]);
  });
});

describe("an old Basic file opens the same (الأمر 3)", () => {
  /**
   * A Basic file saved before a tour had a car count: nine travellers in two
   * vans, KL 3 → Langkawi 3 (by air) → Genting 2 (by road). A typed tour, a free
   * day, a tour priced from the old list by its per-car name, an undated one, a
   * city whose tour was never picked, and a day the agent rewrote by hand.
   */
  function oldBasicFile(): DraftData {
    let data = emptyDraftData();
    data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-11-11", nights: 8, days: 9, adults: 7, children: 2, meal_plan: "breakfast" };
    data.flights = [];
    for (const [name, nights, tours, id, price] of [
      ["كوالالمبور", 3, 2, "h-kl", 1800],
      ["لنكاوي", 3, 2, "h-lgk", 2400],
      ["جنتنج", 2, 1, "h-gt", 900],
    ] as const) {
      data = { ...data, ...addCity(data, { name, nights, tours, hotel: { id, name: `فندق ${name}` }, room: "غرفة ثلاثية", rooms: 3, price }, "SAR") };
    }
    data.transport_plan = {
      ...data.transport_plan,
      airport: { ...data.transport_plan.airport, car_type: "فان", cars: 2 },
      tours: { ...data.transport_plan.tours, car_type: "فان", cars: 2 },
      intercity: { ...data.transport_plan.intercity, enabled: true, modes: ["car", "flight"], mode: "car", hop_modes: { "كوالالمبور>لنكاوي": "flight" } },
    };
    data.flights = [{ ...emptyFlight("internal"), from_city: "كوالالمبور", to_city: "لنكاوي", flight_no: "AK6302" }];
    data.cities = data.cities.map((c, i) =>
      i === 0
        ? {
            ...c,
            tour_picks: [
              { program_id: "p-kl", title: "جولة المدينة", text: "برجا بتروناس وساحة الاستقلال", price: 400, date: "2026-11-12" },
              { program_id: null, title: "يوم حر", text: "", price: 0, date: "2026-11-13", free: true },
            ],
          }
        : i === 1
          ? {
              ...c,
              tour_picks: [
                { program_id: null, title: "جزيرة الحامل (سيدان)", text: "", price: null, date: "2026-11-15", car_type: "سيدان" },
                { program_id: null, title: "التلفريك", text: "التلفريك والجسر المعلق", price: 650 },
              ],
            }
          : c,
    );
    data.days = basicDays(data);
    data.days = data.days.map((d) => (d.date === "2026-11-16" ? { ...d, title: "يوم على الشاطئ", activities: ["سباحة"] } : d));
    // saved, then opened again
    return normalizeDraftData(JSON.parse(JSON.stringify(data)));
  }

  const REFERENCE: PricingReference = {
    transfers: [
      { from_city: "مطار كوالالمبور الدولي", to_city: "كوالالمبور", car_type: "فان", price: 150, currency: "MYR" },
      { from_city: "جنتنج", to_city: "مطار كوالالمبور الدولي", car_type: "فان", price: 260, currency: "MYR" },
    ],
    services: [],
    rooms: [],
    fleet: [],
    tours: [{ name: "جزيرة الحامل (سيدان)", price: 180, currency: "MYR" }],
  };

  it("writes the same days and prices the same total, to the riyal", () => {
    const data = oldBasicFile();
    const days = basicDays(data);
    expect(days.map((d) => [d.date, d.title, ...d.activities])).toMatchInlineSnapshot(`
      [
        [
          "2026-11-11",
          "الوصول إلى كوالالمبور",
          "الاستقبال من المطار من قبل موظف ترافليون والتوجه إلى الفندق",
        ],
        [
          "2026-11-12",
          "جولة المدينة",
          "برجا بتروناس وساحة الاستقلال",
          "التنقل بـفان",
        ],
        [
          "2026-11-13",
          "يوم حر",
        ],
        [
          "2026-11-14",
          "السفر إلى لنكاوي",
          "تسجيل الخروج من الفندق والتوجه إلى المطار",
          "السفر إلى لنكاوي على الطيران الداخلي (AK6302)",
          "الاستقبال في مطار لنكاوي والتوجه إلى الفندق",
        ],
        [
          "2026-11-15",
          "جزيرة الحامل (سيدان)",
          "التنقل بـسيدان",
        ],
        [
          "2026-11-16",
          "يوم على الشاطئ",
          "سباحة",
        ],
        [
          "2026-11-17",
          "الانتقال إلى جنتنج",
          "تسجيل الخروج من الفندق",
          "الانتقال براً إلى جنتنج والتوجه إلى الفندق",
        ],
        [
          "2026-11-18",
          "جولة سياحية في جنتنج",
          "التنقل بـفان",
        ],
        [
          "2026-11-19",
          "المغادرة",
          "تسجيل الخروج من الفندق والتوجه إلى المطار للمغادرة",
        ],
      ]
    `);
    const items = suggestPricing(data, REFERENCE, { hotel: "فندق", airline: "الناقل" });
    // a stay's ref is its random id: read it by its city and hotel
    expect(items.map((i) => [i.item_type === "hotel" ? i.description : i.ref, i.quantity, i.sell_price, i.sell_currency])).toMatchInlineSnapshot(`
      [
        [
          "كوالالمبور — فندق كوالالمبور",
          1,
          5400,
          "SAR",
        ],
        [
          "لنكاوي — فندق لنكاوي",
          1,
          7200,
          "SAR",
        ],
        [
          "جنتنج — فندق جنتنج",
          1,
          2700,
          "SAR",
        ],
        [
          "flight:dom",
          1,
          null,
          "SAR",
        ],
        [
          "transport:المطار>فندق كوالالمبور>فان × 2",
          2,
          150,
          "MYR",
        ],
        [
          "transport:فندق جنتنج>المطار>فان × 2",
          2,
          260,
          "MYR",
        ],
        [
          "transport:فندق كوالالمبور>المطار>فان × 2",
          2,
          150,
          "MYR",
        ],
        [
          "transport:المطار>فندق لنكاوي>فان × 2",
          2,
          null,
          "SAR",
        ],
        [
          "transport:لنكاوي>جنتنج>سيارة",
          1,
          null,
          "SAR",
        ],
        [
          "tour:كوالالمبور:0",
          1,
          400,
          "SAR",
        ],
        [
          "tour:لنكاوي:0",
          1,
          180,
          "MYR",
        ],
        [
          "tour:لنكاوي:1",
          1,
          650,
          "SAR",
        ],
      ]
    `);
    // a file from before the days carried their mark reads the same
    const unmarked = { ...data, days: data.days.map((d) => ({ ...d, auto_title: undefined })) };
    const text = (list: typeof days) => list.map((d) => [d.date, d.title, ...d.activities]);
    expect(text(basicDays(unmarked))).toEqual(text(days));
    const total: Record<string, number> = {};
    for (const i of items) total[i.sell_currency] = (total[i.sell_currency] ?? 0) + (i.sell_price ?? 0) * i.quantity;
    expect(total).toMatchInlineSnapshot(`
      {
        "MYR": 1300,
        "SAR": 16350,
      }
    `);
  });

  const LABELS = { hotel: "فندق", airline: "الناقل" };

  it("«جولة قبل المغادرة» moves no tour of this file — the same days and total, even with a date left on the day home", () => {
    const data = oldBasicFile();
    // جنتنج, the last city (17–18 Nov, home on the 19th), once had a third night: its tour's date is the day home now
    const stale = { ...data, cities: data.cities.map((c, i) => (i === 2 ? { ...c, tour_picks: [{ program_id: null, title: "", text: "", price: null, date: "2026-11-19" }] } : c)) };
    const last = data.cities.length - 1;
    for (const file of [data, stale]) {
      // every city's tours on the days they had before the day home could hold one
      expect(file.cities.map((c, i) => withTours(c, c.tours ?? 0, undefined, i === last).map((p) => p.date))).toEqual(
        data.cities.map((c) => withTours(c, c.tours ?? 0).map((p) => p.date)),
      );
      expect(basicDays(file)).toEqual(basicDays(data));
      expect(suggestPricing(file, REFERENCE, LABELS)).toEqual(suggestPricing(data, REFERENCE, LABELS));
    }
    expect(basicDays(stale).at(-1)!.activities).toEqual(["تسجيل الخروج من الفندق والتوجه إلى المطار للمغادرة"]);
  });

  it("a tour the agent puts on the day home prints before the farewell, priced per car like the rest", () => {
    const data = oldBasicFile();
    const cities = data.cities.map((c, i) =>
      i === 2
        ? {
            ...c,
            tours: 2,
            tour_picks: [...withTours(c, 1, undefined, true), { program_id: null, title: "مزارع الفراولة", text: "", price: 300, date: "2026-11-19", cars: 2, departure: true }],
          }
        : c,
    );
    const days = basicDays({ ...data, cities });
    expect([days.at(-1)!.title, days.at(-1)!.activities]).toEqual([
      "المغادرة",
      ["مزارع الفراولة", "التنقل بـفان × 2", "تسجيل الخروج من الفندق والتوجه إلى المطار للمغادرة"],
    ]);
    // the rest of the programme is the file's own
    expect(days.slice(0, -1)).toEqual(basicDays(data).slice(0, -1));
    const line = suggestPricing({ ...data, cities, days }, REFERENCE, LABELS).find((i) => i.ref === "tour:جنتنج:1");
    expect([line?.quantity, line?.sell_price]).toEqual([2, 300]);
  });
});

describe("the day follows its tour (الأمر 3)", () => {
  /** لنكاوي 13–16 Nov: one tour on the 14th. */
  function withTour(pick: Partial<TourPick>): DraftData {
    const data = malaysia();
    data.transport_plan = { ...data.transport_plan, tours: { ...data.transport_plan.tours, car_type: "فان", cars: 2 } };
    data.cities = data.cities.map((c, i) =>
      i === 1 ? { ...c, tours: 1, tour_picks: [{ program_id: "p1", title: "جزيرة الحامل", text: "رحلة بحرية", price: 400, date: "2026-11-14", ...pick }] } : c,
    );
    return { ...data, days: basicDays(data) };
  }
  const on = (data: DraftData, date: string) => data.days.find((d) => d.date === date)!;

  it("names the tour's cars and how many — a pick from before the count is one car", () => {
    expect(on(withTour({ cars: 2 }), "2026-11-14").activities).toEqual(["رحلة بحرية", "التنقل بـفان × 2"]);
    expect(on(withTour({}), "2026-11-14").activities).toEqual(["رحلة بحرية", "التنقل بـفان"]);
  });

  it("rewrites its day when the tour changes, and gives the day back when it goes", () => {
    const data = withTour({ cars: 2 });
    const changed = { ...data, cities: data.cities.map((c, i) => (i === 1 ? { ...c, tour_picks: [{ ...c.tour_picks![0], title: "التلفريك", text: "" }] } : c)) };
    expect(on({ ...changed, days: basicDays(changed) }, "2026-11-14").title).toBe("التلفريك");
    const gone = { ...data, cities: data.cities.map((c, i) => (i === 1 ? { ...c, tours: 0, tour_picks: [] } : c)) };
    expect([on({ ...gone, days: basicDays(gone) }, "2026-11-14").title, on({ ...gone, days: basicDays(gone) }, "2026-11-14").activities]).toEqual(["يوم حر", []]);
  });
});

describe("a price typed on the sheet is a cost (AD-4-8573: the sheet showed 4,040.82, the offer issued at 3,995.82)", () => {
  it("writes the typed figure as cost and sell, so the profit the sheet shows is the profit issued", () => {
    // «بونشاك ← بالي (سيارة صغيرة)»: no list price, no place to write it back — the agent types 300
    const line = { item_type: "transport", description: "بونشاك ← بالي", quantity: 1, buy_price: null, buy_currency: null, sell_price: null, sell_currency: "SAR" } as unknown as DraftPricingItem;
    const typed = { ...line, ...typedSheetPrice({ sell_price: 300 }, false) };
    expect(typed).toMatchObject({ buy_price: 300, sell_price: 300, overridden: true });
    const profit = { mode: "pct" as const, value: 15 };
    // the sheet (BasicEditor: a line without cost counts as cost) and the issue (as stored) now agree
    const asCost = (i: DraftPricingItem) => (i.buy_price == null ? { ...i, buy_price: i.sell_price } : i);
    const shown = withPackageProfit([asCost(typed)], profit, { SAR: 1 }, "SAR")[0];
    const issued = withPackageProfit([typed], profit, { SAR: 1 }, "SAR")[0];
    const sell = (i: DraftPricingItem) => applyManualProfit(i.buy_price, i.sell_price, i.profit_pct, i.profit_amount);
    expect(sell(shown)).toBe(345);
    expect(sell(issued)).toBe(345);
  });

  it("keeps a line with a place to write back to as ours (not overridden)", () => {
    expect(typedSheetPrice({ sell_price: 1200, sell_currency: "MYR" }, true)).toEqual({ sell_price: 1200, sell_currency: "MYR", buy_price: 1200, buy_currency: "MYR", overridden: false });
  });
});
