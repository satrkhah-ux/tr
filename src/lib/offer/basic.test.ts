import { describe, expect, it } from "vitest";
import { emptyDraftData, withRooms, type DraftData } from "./draft-types";
import {
  addCity,
  baseRoomName,
  basicDays,
  changeRoom,
  cityLines,
  clearRoomChange,
  EXTRA_BED,
  extraBeds,
  remainingNights,
  renameRooms,
  setCityNights,
  withExtraBeds,
  withHotelLines,
  withTripDates,
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
});
