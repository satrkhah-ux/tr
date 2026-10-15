import { describe, expect, it } from "vitest";
import { cityHotelLines, deriveHotelStays, emptyDraftData, type DraftData } from "./draft-types";
import { addCity, basicDays, moveCity, replaceCity, setCityNights } from "./basic";

/** Kuala Lumpur 4 nights, Langkawi 4 nights — each with its hotel; then Penang 2 added at the end. */
function trip(): DraftData {
  let data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", arrival_date: "2026-10-20", nights: 10, days: 11 };
  data = { ...data, ...addCity(data, { name: "كوالالمبور", nights: 4, tours: 0, hotel: { id: "h1", name: "ذا ساوجانا" } }, "SAR") };
  data = { ...data, ...addCity(data, { name: "لنكاوي", nights: 4, tours: 1, hotel: { id: "h2", name: "ريتز كارلتون" } }, "SAR") };
  data = { ...data, ...addCity(data, { name: "بينانج", nights: 2, tours: 0 }, "SAR") };
  return data;
}

describe("moveCity — a city dragged to another place in the trip", () => {
  it("puts Penang before Langkawi, with its dates chained again and every hotel still with its city", () => {
    const data = trip();
    const moved = { ...data, ...moveCity(data, 2, 1) };
    expect(moved.cities.map((c) => [c.city_name, c.check_in, c.check_out])).toEqual([
      ["كوالالمبور", "2026-10-20", "2026-10-24"],
      ["بينانج", "2026-10-24", "2026-10-26"],
      ["لنكاوي", "2026-10-26", "2026-10-30"],
    ]);
    expect(cityHotelLines(moved.cities, moved.hotels, 2).map((h) => h.hotel_name)).toEqual(["ريتز كارلتون"]);
    expect(cityHotelLines(moved.cities, moved.hotels, 0).map((h) => h.hotel_name)).toEqual(["ذا ساوجانا"]);
  });

  it("gives back a night in the air when the city no longer follows the one it flew from", () => {
    const data = trip();
    data.cities = data.cities.map((c, i) => (i === 1 ? { ...c, nights: 3, arrives_next_day: true } : c));
    const moved = moveCity(data, 2, 1);
    expect(moved.cities.map((c) => [c.city_name, c.nights, Boolean(c.arrives_next_day)])).toEqual([
      ["كوالالمبور", 4, false],
      ["بينانج", 2, false],
      ["لنكاوي", 4, false],
    ]);
  });

  it("leaves the trip as it is for a move nowhere", () => {
    const data = trip();
    expect(moveCity(data, 1, 1).cities).toBe(data.cities);
    expect(moveCity(data, 0, 5).cities).toBe(data.cities);
  });
});

describe("replaceCity — «تعديل المدينة»", () => {
  it("keeps the nights and the tour days, drops the old city's tours and hotel", () => {
    let data = trip();
    data.cities = data.cities.map((c, i) => (i === 1 ? { ...c, tour_picks: [{ program_id: "p", title: "جولة الجزر", text: "قارب", price: 200, date: "2026-10-25" }] } : c));
    data = { ...data, ...replaceCity(data, 1, { name: "جزيرة بينانج" }) };
    expect(data.cities[1]).toMatchObject({ city_name: "جزيرة بينانج", nights: 4, check_in: "2026-10-24" });
    expect(data.cities[1].tour_picks).toEqual([{ program_id: null, title: "", text: "", price: null, date: "2026-10-25" }]);
    const [line] = cityHotelLines(data.cities, data.hotels, 1);
    expect(line).toMatchObject({ city_name: "جزيرة بينانج", hotel_id: null, hotel_name: "" });
    expect(line.rooms.every((r) => r.price === null)).toBe(true);
    // the other cities' hotels are untouched
    expect(cityHotelLines(data.cities, data.hotels, 0)[0].hotel_name).toBe("ذا ساوجانا");
  });
});

describe("what a reorder or «تعديل المدينة» must not break", () => {
  it("refuses to put the same city twice in a row — KL, Langkawi, KL with Langkawi moved to the end", () => {
    let data = trip();
    data = { ...data, ...replaceCity(data, 2, { name: "كوالالمبور" }) };
    expect(data.cities.map((c) => c.city_name)).toEqual(["كوالالمبور", "لنكاوي", "كوالالمبور"]);
    expect(moveCity(data, 1, 2).cities).toBe(data.cities);
    expect(replaceCity(data, 1, { name: "كوالالمبور" }).cities).toBe(data.cities);
  });

  it("carries a day the agent wrote with its city, and hands the vacated one back to the screen", () => {
    let data = trip();
    data = { ...data, days: basicDays(data) };
    // the 2nd day of Langkawi (2026-10-25), written by hand
    data = { ...data, days: data.days.map((d) => (d.date === "2026-10-25" ? { ...d, title: "رحلة الجزر الثلاث", activities: ["قارب"], auto_title: "" } : d)) };
    const moved = { ...data, ...moveCity(data, 2, 1) };
    const days = basicDays(moved);
    // Langkawi now starts on the 26th: its 2nd day is the 27th
    expect(days.find((d) => d.date === "2026-10-27")).toMatchObject({ city_name: "لنكاوي", title: "رحلة الجزر الثلاث" });
    expect(days.find((d) => d.date === "2026-10-25")?.title).not.toBe("رحلة الجزر الثلاث");
  });

  it("gives the night in the air back with the stay's typed total grown to it", () => {
    let data = trip();
    // Langkawi typed at 1200 for 4 nights; an overnight flight in takes one night (900 for 3)
    data = { ...data, hotels: data.hotels.map((h) => (h.hotel_name === "ريتز كارلتون" ? { ...h, rooms: h.rooms.map((r) => ({ ...r, price: 1200 })) } : h)) };
    data = { ...data, ...setCityNights(data, 1, 3) };
    data = { ...data, cities: data.cities.map((c, i) => (i === 1 ? { ...c, arrives_next_day: true } : c)) };
    const moved = { ...data, ...moveCity(data, 2, 1) };
    const stay = deriveHotelStays(moved.cities, moved.hotels).find((x) => x.line.hotel_name === "ريتز كارلتون")!;
    expect([stay.nights, stay.line.rooms[0].price]).toEqual([4, 1200]);
  });

  it("leaves a by-name hotel line that another visit still reads with that visit", () => {
    let data = trip();
    data = { ...data, ...replaceCity(data, 2, { name: "كوالالمبور" }) };
    // an older file: the KL line has no key — both KL visits read it by name
    data = {
      ...data,
      hotels: data.hotels
        .filter((h) => h.city_name !== "كوالالمبور" || h.hotel_name === "ذا ساوجانا")
        .map((h) => (h.city_name === "كوالالمبور" ? { ...h, city_key: undefined } : h)),
    };
    const next = replaceCity(data, 0, { name: "بينانج" });
    expect(next.hotels.find((h) => h.hotel_name === "ذا ساوجانا")?.city_name).toBe("كوالالمبور");
  });
});
