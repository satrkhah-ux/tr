import { describe, expect, it } from "vitest";
import {
  buildDaySkeleton,
  cityForDate,
  dayCount,
  daysNeedRebuild,
  draftDaySkeleton,
  emptyDays,
  itineraryCities,
  itineraryComplete,
} from "./itinerary";
import { deriveCityDates, emptyDraftData, type DraftCity, type DraftDay } from "./draft-types";

function city(city_name: string, nights: number): DraftCity {
  return { city_name, nights, check_in: null, check_out: null };
}

function day(over: Partial<DraftDay> & { day_number: number }): DraftDay {
  return {
    date: null,
    city_name: "",
    title: "",
    activities: [],
    weather: null,
    ai_generated: false,
    ...over,
  };
}

const TRIP = { nights: 6, days: 7, arrival_date: "2026-08-01" };
const CITIES = [city("كوالالمبور", 3), city("لنكاوي", 3)];

describe("dayCount", () => {
  it("is nights + 1 — arrival day through departure day", () => {
    expect(dayCount({ nights: 6, days: 7 })).toBe(7);
    expect(dayCount({ nights: 1, days: 0 })).toBe(2);
  });

  it("falls back to the explicit day count when no nights are set", () => {
    expect(dayCount({ nights: 0, days: 4 })).toBe(4);
  });

  it("is zero for an untouched trip", () => {
    expect(dayCount({ nights: 0, days: 0 })).toBe(0);
  });
});

describe("cityForDate", () => {
  const dated = deriveCityDates("2026-08-01", CITIES);

  it("returns the city whose stay covers the date", () => {
    expect(cityForDate("2026-08-01", dated)).toBe("كوالالمبور");
    expect(cityForDate("2026-08-03", dated)).toBe("كوالالمبور");
    expect(cityForDate("2026-08-04", dated)).toBe("لنكاوي"); // first city checked out
  });

  it("gives the departure day to the LAST city — you fly home from there", () => {
    // 2026-08-07 is the final check-out, which no stay covers
    expect(cityForDate("2026-08-07", dated)).toBe("لنكاوي");
  });

  it("is empty when there is nothing to place the date in", () => {
    expect(cityForDate(null, dated)).toBe("");
    expect(cityForDate("2026-08-01", [])).toBe("");
  });
});

describe("buildDaySkeleton", () => {
  it("builds one day per night plus the departure day, dated in sequence", () => {
    const days = buildDaySkeleton(TRIP, CITIES);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ day_number: 1, date: "2026-08-01", city_name: "كوالالمبور" });
    expect(days[6]).toMatchObject({ day_number: 7, date: "2026-08-07", city_name: "لنكاوي" });
  });

  it("assigns each day the city that its date falls in", () => {
    const days = buildDaySkeleton(TRIP, CITIES);
    expect(days.map((d) => d.city_name)).toEqual([
      "كوالالمبور",
      "كوالالمبور",
      "كوالالمبور",
      "لنكاوي",
      "لنكاوي",
      "لنكاوي",
      "لنكاوي",
    ]);
  });

  it("PRESERVES authored text when the trip is rebuilt", () => {
    const existing = [day({ day_number: 2, title: "جولة المدينة", activities: ["البرجان التوأمان"] })];
    const days = buildDaySkeleton(TRIP, CITIES, existing);
    expect(days[1].title).toBe("جولة المدينة");
    expect(days[1].activities).toEqual(["البرجان التوأمان"]);
    expect(days[0].title).toBe(""); // untouched days stay empty
  });

  it("drops the tail when the trip shortens and appends empties when it grows", () => {
    const written = buildDaySkeleton(TRIP, CITIES).map((d) => ({ ...d, title: `يوم ${d.day_number}` }));
    const shorter = buildDaySkeleton({ nights: 3, days: 4, arrival_date: "2026-08-01" }, [city("كوالالمبور", 3)], written);
    expect(shorter).toHaveLength(4);
    expect(shorter[3].title).toBe("يوم 4");

    const longer = buildDaySkeleton({ nights: 8, days: 9, arrival_date: "2026-08-01" }, CITIES, written);
    expect(longer).toHaveLength(9);
    expect(longer[8].title).toBe("");
  });

  it("DROPS a cached weather reading when the day's date moves", () => {
    const withWeather = buildDaySkeleton(TRIP, CITIES).map((d) => ({
      ...d,
      weather: {
        temp_max: 32,
        temp_min: 24,
        rain_chance: 40,
        code: 3,
        source: "forecast" as const,
        fetched_at: "2026-07-20T10:00:00.000Z",
      },
    }));
    // the whole trip shifts a month later — last month's reading must not survive
    const moved = buildDaySkeleton({ ...TRIP, arrival_date: "2026-09-01" }, CITIES, withWeather);
    expect(moved.every((d) => d.weather === null)).toBe(true);
  });

  it("keeps the weather when the date is unchanged", () => {
    const withWeather = buildDaySkeleton(TRIP, CITIES).map((d) => ({
      ...d,
      weather: {
        temp_max: 32,
        temp_min: 24,
        rain_chance: 40,
        code: 3,
        source: "normals" as const,
        fetched_at: "2026-07-20T10:00:00.000Z",
      },
    }));
    const same = buildDaySkeleton(TRIP, CITIES, withWeather);
    expect(same[0].weather?.temp_max).toBe(32);
  });

  it("still builds undated days when the trip has no arrival date", () => {
    const days = buildDaySkeleton({ nights: 2, days: 3, arrival_date: null }, CITIES);
    expect(days).toHaveLength(3);
    expect(days.every((d) => d.date === null)).toBe(true);
  });

  it("is empty for a trip with no length", () => {
    expect(buildDaySkeleton({ nights: 0, days: 0, arrival_date: "2026-08-01" }, CITIES)).toEqual([]);
  });
});

describe("draftDaySkeleton (whole draft, as the stage calls it)", () => {
  // Shape of a real draft: 5 nights, two consecutive stays in the same city,
  // and an outbound flight whose arrival time was never filled in.
  const draft = {
    ...emptyDraftData(),
    trip: { ...emptyDraftData().trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-07-20", days: 6, nights: 5 },
    cities: [city("سيلانجور", 2), city("سيلانجور", 3)],
    flights: [
      {
        airline: "اير اسيا",
        flight_no: "",
        from_airport: "مطار كوالالمبور الدولي (KUL)",
        to_airport: "مطار أثينا الدولي (ATH)",
        departure_at: "2026-07-20T00:00",
        arrival_at: null,
        from_tz: null,
        to_tz: null,
        date_user_set: false,
        cabin_class: "",
        baggage_allowance: "",
        leg_order: "outbound" as const,
      },
    ],
  };

  it("names the city on every day — an unfilled flight arrival must not blank it", () => {
    const days = draftDaySkeleton(draft);
    expect(days).toHaveLength(6);
    expect(days.map((d) => d.city_name)).toEqual(Array(6).fill("سيلانجور"));
    expect(days[0].date).toBe("2026-07-20");
  });

  it("falls back to the DESTINATION when the cities were never named", () => {
    // Real drafts exist where the agent typed the city into the hotel field and
    // left city_name blank — the day must still say where it is.
    const unnamed = { ...draft, cities: [city("", 2), city("", 3)] };
    expect(draftDaySkeleton(unnamed).map((d) => d.city_name)).toEqual(Array(6).fill("ماليزيا"));
  });

  it("leaves the city empty when there is no destination either", () => {
    const nowhere = { ...draft, cities: [], trip: { ...draft.trip, country: "", destination: "" } };
    expect(draftDaySkeleton(nowhere).every((d) => d.city_name === "")).toBe(true);
  });
});

describe("daysNeedRebuild", () => {
  it("is false when the skeleton already matches the trip", () => {
    expect(daysNeedRebuild(TRIP, CITIES, buildDaySkeleton(TRIP, CITIES))).toBe(false);
  });

  it("is true when the trip length changed", () => {
    const days = buildDaySkeleton(TRIP, CITIES);
    expect(daysNeedRebuild({ nights: 8, days: 9, arrival_date: "2026-08-01" }, CITIES, days)).toBe(true);
  });

  it("is true when the dates moved", () => {
    const days = buildDaySkeleton(TRIP, CITIES);
    expect(daysNeedRebuild({ ...TRIP, arrival_date: "2026-09-01" }, CITIES, days)).toBe(true);
  });

  it("is true when the city split changed even though the length did not", () => {
    const days = buildDaySkeleton(TRIP, CITIES);
    expect(daysNeedRebuild(TRIP, [city("كوالالمبور", 5), city("لنكاوي", 1)], days)).toBe(true);
  });
});

describe("emptyDays / itineraryComplete / itineraryCities", () => {
  it("counts a day with only whitespace as empty", () => {
    const days = [day({ day_number: 1, title: "  ", activities: ["  "] }), day({ day_number: 2, title: "وصول" })];
    expect(emptyDays(days).map((d) => d.day_number)).toEqual([1]);
  });

  it("is complete only when every day has a title", () => {
    expect(itineraryComplete([day({ day_number: 1, title: "وصول" })])).toBe(true);
    expect(itineraryComplete([day({ day_number: 1, title: "وصول" }), day({ day_number: 2 })])).toBe(false);
    expect(itineraryComplete([])).toBe(false);
  });

  it("lists the distinct cities in visit order", () => {
    const days = buildDaySkeleton(TRIP, CITIES);
    expect(itineraryCities(days)).toEqual(["كوالالمبور", "لنكاوي"]);
  });
});
