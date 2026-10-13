import { describe, expect, it } from "vitest";
import { deriveTransportRows, emptyDraftData, emptyFlight, withRooms, type DraftData, type LookupAirport } from "./draft-types";
import { findTourPrice } from "./pricing-suggest";
import { domesticMismatches } from "./flight-cities";
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
  withScopeLines,
  priceGroupOf,
  planInternational,
  remainingNights,
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
    const split = { ...data, ...changeRoom(data, "لنكاوي", 1, "جناح") };
    const [first, second] = cityLines(split.hotels, "لنكاوي");
    expect([first.nights, first.rooms[0].price]).toEqual([1, 300]);
    expect([second.nights, second.rooms[0].room_type_name, second.rooms[0].price]).toEqual([0, "جناح", null]);
    expect(split.hotels.map((h) => h.city_name)).toEqual(["سيلانغور", "لنكاوي", "لنكاوي", "كوالالمبور"]);

    const joined = clearRoomChange(split, "لنكاوي").hotels;
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

  it("suggests the clear room names first, then only the chosen hotel's own", () => {
    const types = [
      { id: "a", name: "ديلوكس", hotel_id: "h1", default_board: null },
      { id: "b", name: "سويت المحيط", hotel_id: "h2", default_board: null },
    ];
    expect(roomSuggestions(types, "h1")).toEqual([...STANDARD_ROOMS, "ديلوكس"]);
    expect(roomSuggestions(types, null)).toEqual(STANDARD_ROOMS);
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
