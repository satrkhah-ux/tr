import { describe, expect, it } from "vitest";
import { emptyDraftData, type DraftData } from "./draft-types";
import { addCity, basicDays, remainingNights, setCityNights, type BasicCity } from "./basic";

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
});
