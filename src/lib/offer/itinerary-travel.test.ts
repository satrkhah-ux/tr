import { describe, expect, it } from "vitest";
import { deriveCityDates, emptyDraftData, emptyFlight, type DraftData } from "./draft-types";
import { draftDaySkeleton, transportNoteForDay, travelDaysBefore } from "./itinerary";
import { itineraryStartDate } from "./schedule";

/** The user's own example: the plane leaves on the 15th and lands on the 16th. */
function overnightTrip(): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-15", nights: 9, days: 10 };
  data.flights = [
    { ...emptyFlight("outbound"), to_city: "كوالالمبور", departure_at: "2026-10-15T22:00", arrival_at: "2026-10-16T11:00" },
    { ...emptyFlight("internal"), from_city: "كوالالمبور", to_city: "لنكاوي", flight_no: "AK6300", departure_at: "2026-10-19T09:00", arrival_at: "2026-10-19T10:05" },
    { ...emptyFlight("inbound"), from_city: "لنكاوي", departure_at: "2026-10-25T14:00", arrival_at: "2026-10-25T18:00" },
  ];
  data.cities = deriveCityDates("2026-10-16", [
    { city_name: "كوالالمبور", nights: 3, check_in: null, check_out: null },
    { city_name: "لنكاوي", nights: 6, check_in: null, check_out: null },
  ]);
  data.transport_plan.airport = { enabled: true, car_type: "فان", cars: 1, note: "" };
  return data;
}

describe("the programme starts when the plane leaves, the hotels when it lands", () => {
  it("counts one travel day for an overnight outbound", () => {
    expect(travelDaysBefore("2026-10-16", overnightTrip().flights)).toBe(1);
    expect(travelDaysBefore("2026-10-15", overnightTrip().flights)).toBe(0);
  });

  it("puts the 15th first as a travel day and the first city on the 16th", () => {
    const days = draftDaySkeleton(overnightTrip());
    expect(days[0]).toMatchObject({ date: "2026-10-15", kind: "travel", city_name: "", title: "السفر إلى ماليزيا" });
    expect(days[1]).toMatchObject({ date: "2026-10-16", city_name: "كوالالمبور" });
    expect(days[1].kind).toBeUndefined();
    expect(days[days.length - 1].date).toBe("2026-10-25");
  });

  it("meets the group at the airport on the day it lands, not the day it leaves", () => {
    const data = overnightTrip();
    const days = draftDaySkeleton(data);
    expect(transportNoteForDay(data.transport_plan, days, 0, data.flights)).toBeNull();
    expect(transportNoteForDay(data.transport_plan, days, 1, data.flights)).toMatch(/^استقبال من المطار إلى الفندق/);
  });

  it("moves the group on the domestic flight's day, by that flight", () => {
    const data = overnightTrip();
    const days = draftDaySkeleton(data);
    const hop = days.findIndex((d) => d.date === "2026-10-19");
    expect(days[hop].city_name).toBe("لنكاوي");
    expect(transportNoteForDay(data.transport_plan, days, hop, data.flights)).toContain("الانتقال إلى لنكاوي — طيران داخلي (AK6300، الإقلاع 09:00، الوصول 10:05)");
  });

  it("keeps the arrival day's text on the arrival date when a travel day is added in front", () => {
    const data = overnightTrip();
    data.days = [{ day_number: 1, date: "2026-10-16", city_name: "كوالالمبور", title: "الوصول", activities: [], weather: null, ai_generated: false }];
    const days = draftDaySkeleton(data);
    expect(days.find((d) => d.date === "2026-10-16")?.title).toBe("الوصول");
  });

  it("keeps every day's text when the whole trip moves, dropping only stale weather", () => {
    const data = overnightTrip();
    data.days = draftDaySkeleton(data).map((d, i) => ({
      ...d,
      title: `يوم ${i + 1}`,
      weather: { temp_max: 30, temp_min: 24, rain_chance: 10, code: 1, source: "forecast" as const, fetched_at: "x" },
    }));
    // the same trip, one week later
    data.flights = data.flights.map((f) => ({
      ...f,
      departure_at: f.departure_at!.replace("2026-10-", "2026-11-").replace(/-(\d\d)T/, (_m, d) => `-${String(Number(d)).padStart(2, "0")}T`),
      arrival_at: f.arrival_at!.replace("2026-10-", "2026-11-"),
    }));
    data.cities = deriveCityDates("2026-11-16", data.cities);
    const moved = draftDaySkeleton(data);
    expect(moved.map((d) => d.title)).toEqual(data.days.map((d) => d.title));
    expect(moved.every((d) => d.weather === null)).toBe(true);
  });

  it("starts the hotels where a transit outbound finally lands", () => {
    const data = overnightTrip();
    data.flights = [
      { ...emptyFlight("outbound"), to_city: "", departure_at: "2026-10-15T08:00", arrival_at: "2026-10-15T10:00" },
      { ...emptyFlight("outbound"), to_city: "كوالالمبور", departure_at: "2026-10-15T22:00", arrival_at: "2026-10-16T11:00" },
      ...data.flights.slice(1),
    ];
    expect(itineraryStartDate(data.trip, data.flights)).toBe("2026-10-16");
  });
});
