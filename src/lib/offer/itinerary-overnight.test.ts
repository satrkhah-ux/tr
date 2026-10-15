import { describe, expect, it } from "vitest";
import { deriveCityDates, emptyDraftData, normalizeDraftData, totalCityNights, travelNights, type DraftData, type LookupAirport } from "./draft-types";
import { arrivalLines, daysFromTours, departureLines, FAREWELL, transportNoteForDay, WELCOME } from "./itinerary";
import { remainingNights, withDomesticFlights } from "./basic";
import { domesticMismatches } from "./flight-cities";

const AIRPORTS: LookupAirport[] = [
  { id: "1", name: "مطار كوالالمبور الدولي", code: "KUL", timezone: "Asia/Kuala_Lumpur", city: "كوالالمبور", country: "ماليزيا" },
  { id: "2", name: "مطار لنكاوي الدولي", code: "LGK", timezone: "Asia/Kuala_Lumpur", city: "لنكاوي", country: "ماليزيا" },
];

/**
 * The owner's example: domestic flight on the evening of the 15th, landing after
 * midnight. Kuala Lumpur 3 nights, the night of the 15th in the air, Langkawi 2.
 */
function overnight(): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-11-12", nights: 6, days: 7 };
  data.transport_plan = {
    ...data.transport_plan,
    airport: { enabled: true, car_type: "فان", cars: 1, note: "" },
    tours: { enabled: true, car_type: "سيدان", cars: 1, note: "" },
    intercity: { ...data.transport_plan.intercity, enabled: true, modes: ["flight"], mode: "flight" },
  };
  data.cities = deriveCityDates("2026-11-12", [
    { city_name: "كوالالمبور", nights: 3, check_in: null, check_out: null },
    { city_name: "لنكاوي", nights: 2, arrives_next_day: true, check_in: null, check_out: null },
  ]);
  const flights = withDomesticFlights(data, AIRPORTS).flights;
  // the agent typed the clocks: 22:30, landing 01:10 the next day
  data.flights = flights.map((f) => ({ ...f, departure_at: `${f.departure_at!.slice(0, 10)}T22:30`, arrival_at: "2026-11-16T01:10" }));
  return { ...data, days: daysFromTours(data, true) };
}

describe("an evening domestic flight that lands after midnight — a night in the air, in no hotel", () => {
  it("counts the night in the air as the trip's, not a city's", () => {
    const data = overnight();
    expect(travelNights(data.cities)).toBe(1);
    expect(totalCityNights(data.cities)).toBe(6);
    expect(remainingNights(data)).toBe(0);
    expect(data.cities.map((c) => [c.check_in, c.check_out])).toEqual([
      ["2026-11-12", "2026-11-15"],
      ["2026-11-16", "2026-11-18"],
    ]);
  });

  it("books the leg on the evening the first city checks out, landing the next day — and calls it no mismatch", () => {
    const data = overnight();
    const leg = withDomesticFlights(data, AIRPORTS).flights.find((f) => f.leg_order === "internal")!;
    expect([leg.departure_at, leg.arrival_at]).toEqual(["2026-11-15T22:30", "2026-11-16T01:10"]);
    expect(domesticMismatches(data.flights, data.cities)).toEqual([]);
  });

  it("says the departure clock on the 15th and the landing airport and clock on the 16th", () => {
    const data = overnight();
    const day15 = data.days.find((d) => d.date === "2026-11-15")!;
    const day16 = data.days.find((d) => d.date === "2026-11-16")!;
    expect(day15).toMatchObject({ city_name: "كوالالمبور", title: "السفر إلى لنكاوي" });
    expect(day15.activities.join(" ")).toContain("الإقلاع الساعة 22:30 من مطار كوالالمبور الدولي (KUL)");
    expect(day16).toMatchObject({ city_name: "لنكاوي", title: "الوصول إلى لنكاوي" });
    expect(day16.activities[0]).toBe("الوصول إلى مطار لنكاوي الدولي (LGK) الساعة 01:10");
    // no tour and no free day is put on the evening the group flies
    expect(data.days.map((d) => d.title)).toEqual(["الوصول إلى كوالالمبور", "يوم حر", "يوم حر", "السفر إلى لنكاوي", "الوصول إلى لنكاوي", "يوم حر", "المغادرة"]);
  });

  it("puts the way to the airport on the 15th and the flight's clocks on the 16th — not the tours car", () => {
    const data = overnight();
    const at = (date: string) => data.days.findIndex((d) => d.date === date);
    expect(transportNoteForDay(data.transport_plan, data.days, at("2026-11-15"), data.flights)).toBe(
      "التوجه إلى المطار للسفر إلى لنكاوي — طيران داخلي (الإقلاع 22:30، الوصول 01:10 +1)",
    );
    expect(transportNoteForDay(data.transport_plan, data.days, at("2026-11-16"), data.flights)).toBe(
      "الانتقال إلى لنكاوي — طيران داخلي (الإقلاع 22:30، الوصول 01:10 +1)",
    );
  });

  it("leaves a file without the mark as it was: the move the same day, every night a city's", () => {
    const data = overnight();
    const same = { ...data, cities: deriveCityDates("2026-11-12", data.cities.map((c) => ({ ...c, arrives_next_day: undefined }))) };
    expect(totalCityNights(same.cities)).toBe(5);
    expect(same.cities[1].check_in).toBe("2026-11-15");
  });
});

describe("the welcome and the farewell, in this file's own words", () => {
  it("says the company's default when the file has none", () => {
    const data = overnight();
    expect(arrivalLines(data)).toEqual([WELCOME]);
    expect(departureLines(data)).toEqual([FAREWELL]);
    expect(data.days[0].activities).toEqual([WELCOME]);
  });

  it("puts the typed lines, and a line added, on the arrival and the last day", () => {
    const data = { ...overnight(), arrival_lines: ["الاستقبال من المطار من قبل موظف ترافليون", "تسليم شريحة اتصال"], departure_lines: ["التوجه إلى المطار"] };
    const days = daysFromTours(data, true);
    expect(days[0].activities).toEqual(["الاستقبال من المطار من قبل موظف ترافليون", "تسليم شريحة اتصال"]);
    expect(days.at(-1)!.activities).toEqual(["التوجه إلى المطار"]);
  });

  it("drops blank lines on the way in, and none left is the default again", () => {
    const raw = { ...overnight(), arrival_lines: ["  ", "سطر"], departure_lines: [""] } as unknown as Record<string, unknown>;
    const back = normalizeDraftData(raw);
    expect(back.arrival_lines).toEqual(["سطر"]);
    expect("departure_lines" in back).toBe(false);
  });
});
