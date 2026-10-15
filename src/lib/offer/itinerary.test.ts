import { describe, expect, it } from "vitest";
import {
  buildDaySkeleton,
  cityForDate,
  dayCount,
  daysFromTours,
  daysNeedRebuild,
  draftDaySkeleton,
  emptyDays,
  itineraryCities,
  itineraryComplete,
  dayTours,
  fillCityTours,
  tourService,
  withAiText,
  withDayPick,
  withDayTour,
  withTours,
  type TourProgram,
} from "./itinerary";
import { deriveCityDates, emptyDraftData, normalizeDraftData, type DraftCity, type DraftData, type DraftDay } from "./draft-types";
import { suggestPricing, type PricingReference } from "./pricing-suggest";
import { emptyAdvanced } from "./advanced";

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
        airline_iata: "AK",
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
        baggage_kg: null,
        baggage_pieces: null,
        cabin_baggage_kg: null,
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

describe("daysFromTours — the day and its tour (الأمر 3)", () => {
  /** The generator's file: KL two nights then Langkawi two, nine people in two vans, no day written yet. */
  function klTrip(): DraftData {
    const data = emptyDraftData();
    data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-20", nights: 4, days: 5, adults: 9 };
    data.cities = deriveCityDates("2026-10-20", [city("كوالالمبور", 2), city("لنكاوي", 2)]);
    data.transport_plan = { ...data.transport_plan, tours: { ...data.transport_plan.tours, car_type: "فان", cars: 2 } };
    data.days = draftDaySkeleton(data);
    return data;
  }
  const CITY_TOUR: TourProgram = { id: "p-kl", city_name: "كوالالمبور", title: "جولة المدينة", description: "برجا بتروناس وساحة الاستقلال", is_free_day: false, sort_order: 1 };
  const picked = () => {
    const data = klTrip();
    return { ...data, ...withDayTour(data, 1, CITY_TOUR)! };
  };

  it("gives a tour day the tour's title and activities, and the car it goes in × how many", () => {
    const data = picked();
    expect([data.days[1].title, data.days[1].activities]).toEqual(["جولة المدينة", ["برجا بتروناس وساحة الاستقلال", "التنقل بـفان × 2"]]);
    // the generator's other days stay as they were — empty, for the agent or the AI
    expect(data.days.filter((_, i) => i !== 1).every((d) => d.title === "" && d.activities.length === 0)).toBe(true);
    // and writing it again changes nothing
    expect(daysFromTours(data)).toEqual(data.days);
  });

  it("keeps a title the agent edited; taking the tour away leaves the day empty again", () => {
    const data = picked();
    const edited = { ...data, days: data.days.map((d, i) => (i === 1 ? { ...d, title: "جولة المدينة والأسواق" } : d)) };
    expect(daysFromTours(edited)[1].title).toBe("جولة المدينة والأسواق");

    const removed = { ...data, ...withDayTour(data, 1, null)! };
    expect([removed.days[1].title, removed.days[1].activities]).toEqual(["", []]);
    expect([removed.cities[0].tours, removed.cities[0].tour_picks]).toEqual([0, []]);
  });

  it("keeps the day's weather, and the AI's wording of the same tour", () => {
    const data = picked();
    const weather = { temp_max: 31, temp_min: 24, rain_chance: 60, code: 61, source: "forecast" as const, fetched_at: "2026-10-15T08:00:00Z" };
    const days = data.days.map((d, i) => (i === 1 ? { ...d, weather, activities: ["صباحاً برجا بتروناس، ثم ساحة الاستقلال"], ai_generated: true } : d));
    const out = daysFromTours({ ...data, days })[1];
    expect([out.weather, out.activities, out.ai_generated]).toEqual([weather, ["صباحاً برجا بتروناس، ثم ساحة الاستقلال"], true]);
  });

  it("leaves a generator file's typed days exactly as they were — no tour is made from them", () => {
    const data = klTrip();
    data.days = data.days.map((d, i) => (i === 1 ? { ...d, title: "جولة المدينة", activities: ["كتبها الموظف"] } : i === 3 ? { ...d, title: "يوم حر" } : d));
    // what the stage rebuilt before is what it rebuilds now
    expect(daysFromTours(data)).toEqual(draftDaySkeleton(data));
    expect(data.cities.some((c) => c.tour_picks)).toBe(false);
  });

  it("«بكج متقدم» meeting the group at a border: the arrival day says where, the tours keep the trip car", () => {
    const data = { ...picked(), advanced: { ...emptyAdvanced(), on: true, reception: { kind: "border" as const, place: "معبر سارب", side: "جورجيا", time: "12:30" } } };
    const days = daysFromTours(data, true); // Basic's own programme — it writes the arrival day
    expect(days.find((d) => d.activities.some((a) => a.includes("معبر")))?.activities[0]).toBe("الاستقبال من معبر سارب — جانب جورجيا الساعة 12:30 من قبل موظف ترافليون والتوجه إلى الفندق");
    expect(daysFromTours({ ...picked(), advanced: { ...emptyAdvanced(), on: false } }, true)).toEqual(daysFromTours(picked(), true));
  });
});

describe("the merged day-and-tour screen (الأمر 4)", () => {
  /** KL two nights (20–21) then Langkawi two (22–23), home on the 24th; two vans for the tours. */
  function klTrip(): DraftData {
    const data = emptyDraftData();
    data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-20", nights: 4, days: 5, adults: 9 };
    data.cities = deriveCityDates("2026-10-20", [city("كوالالمبور", 2), city("لنكاوي", 2)]);
    data.transport_plan = { ...data.transport_plan, tours: { ...data.transport_plan.tours, car_type: "فان", cars: 2 } };
    data.days = draftDaySkeleton(data);
    return data;
  }
  const KL1: TourProgram = { id: "kl1", city_name: "كوالالمبور", title: "جولة المدينة", description: "برجا بتروناس", is_free_day: false, sort_order: 1 };
  const KL2: TourProgram = { id: "kl2", city_name: "كوالالمبور", title: "جنتنج", description: "المرتفعات والتلفريك", is_free_day: false, sort_order: 2 };
  const LGK: TourProgram = { id: "lgk", city_name: "لنكاوي", title: "جولة الجزر", description: "ثلاث جزر بالقارب", is_free_day: false, sort_order: 1 };
  const apply = (data: DraftData, slice: Pick<DraftData, "cities" | "days"> | null) => ({ ...data, ...slice! });

  it("swaps the tour on a day in place — the same pick, never a second", () => {
    let data = apply(klTrip(), withDayPick(klTrip(), 1, 0, tourService("جولة المدينة", [KL1, KL2])));
    expect(data.cities[0].tour_picks).toHaveLength(1);
    expect(data.cities[0].tour_picks![0]).toMatchObject({ program_id: "kl1", text: "برجا بتروناس", date: "2026-10-21", cars: 2 });
    data = apply(data, withDayPick(data, 1, 0, tourService("جنتنج", [KL1, KL2])));
    expect(data.cities[0].tour_picks).toHaveLength(1);
    expect([data.cities[0].tours, data.cities[0].tour_picks![0].program_id]).toEqual([1, "kl2"]);
    expect([data.days[1].title, data.days[1].activities]).toEqual(["جنتنج", ["المرتفعات والتلفريك", "التنقل بـفان × 2"]]);
  });

  it("a car or a count reaches the day while it is the screen's, and leaves a hand-written day alone", () => {
    const data = apply(klTrip(), withDayPick(klTrip(), 1, 0, tourService("جولة المدينة", [KL1])));
    const three = apply(data, withDayPick(data, 1, 0, { car_type: "باص", cars: 3 }));
    expect(three.days[1].activities.at(-1)).toBe("التنقل بـباص × 3");
    const typed = { ...data, days: data.days.map((d, i) => (i === 1 ? { ...d, title: "يوم المدينة", auto_title: undefined } : d)) };
    expect(apply(typed, withDayPick(typed, 1, 0, { cars: 3 })).days[1].title).toBe("يوم المدينة");
  });

  it("taking the tour away leaves the day empty and the city without it", () => {
    const data = apply(klTrip(), withDayPick(klTrip(), 1, 0, tourService("جولة المدينة", [KL1])));
    const gone = apply(data, withDayPick(data, 1, 0, null));
    expect([gone.cities[0].tours, gone.cities[0].tour_picks, gone.days[1].title]).toEqual([0, [], ""]);
  });

  it("a tour after arrival: the day keeps the reception, then the tour, in that order", () => {
    const data = apply(klTrip(), withDayPick(klTrip(), 0, 0, tourService("جولة المدينة", [KL1])));
    expect(data.days[0].title).toBe("الوصول إلى كوالالمبور");
    expect(data.days[0].activities).toEqual([
      "الاستقبال من المطار من قبل موظف ترافليون والتوجه إلى الفندق",
      "جولة المدينة: برجا بتروناس",
      "التنقل بـفان × 2",
    ]);
    // two tours in two nights — the arrival day's is one more than nights − 1
    const both = apply(data, withDayPick(data, 1, 0, tourService("جنتنج", [KL1, KL2])));
    expect(both.cities[0].tours).toBe(2);
    expect(dayTours(both, 0)?.picks.map((p) => p.program_id)).toEqual(["kl1"]);
  });

  it("opens already written: an empty day holding a tour picked elsewhere takes it", () => {
    const data = klTrip();
    data.cities = data.cities.map((c, i) => (i === 1 ? { ...c, tours: 1, tour_picks: [{ program_id: "lgk", title: "جولة الجزر", text: "ثلاث جزر بالقارب", price: 300, date: "2026-10-23", cars: 2 }] } : c));
    const days = daysFromTours(data);
    expect([days[3].title, days[3].activities]).toEqual(["جولة الجزر", ["ثلاث جزر بالقارب", "التنقل بـفان × 2"]]);
    // the days without a tour stay the agent's, empty
    expect(days.filter((_, i) => i !== 3).every((d) => d.title === "")).toBe(true);
  });

  it("fills a city's empty touring days with its own programmes, as real tours", () => {
    const data = klTrip();
    const out = fillCityTours(data, [KL1, KL2, LGK], "لنكاوي");
    expect(out.filled).toBe(1);
    expect(out.cities[0].tour_picks).toBeUndefined();
    expect(out.cities[1].tour_picks).toEqual([{ program_id: "lgk", title: "جولة الجزر", text: "ثلاث جزر بالقارب", price: null, cars: 2, free: false, date: "2026-10-23" }]);
    expect(out.days[3].title).toBe("جولة الجزر");
    // without tours on the sale the day takes the text only
    const off = { ...data, transport_plan: { ...data.transport_plan, tours: { ...data.transport_plan.tours, enabled: false } } };
    const text = fillCityTours(off, [LGK], "لنكاوي");
    expect([text.days[3].title, text.cities[1].tour_picks]).toEqual(["جولة الجزر", undefined]);
  });

  it("the AI words a tour day's activities only — its title and car line stay", () => {
    const data = apply(klTrip(), withDayPick(klTrip(), 1, 0, tourService("جولة المدينة", [KL1])));
    const day = withAiText(data, 1, { title: "يوم رائع", activities: ["صباحاً برجا بتروناس ثم السوق المركزي"] });
    expect([day.title, day.activities, day.ai_generated]).toEqual(["جولة المدينة", ["صباحاً برجا بتروناس ثم السوق المركزي", "التنقل بـفان × 2"], true]);
    // and the next pass keeps the AI's wording of the same tour
    expect(daysFromTours({ ...data, days: data.days.map((d, i) => (i === 1 ? day : d)) })[1]).toEqual(day);
    // a day with no tour takes the AI's title as well
    expect(withAiText(data, 3, { title: "يوم على الشاطئ", activities: ["شاطئ سينانج"] }).title).toBe("يوم على الشاطئ");
  });

  it("a new tour from the count goes in the trip's cars; one chosen before keeps its own", () => {
    const kl = { ...klTrip().cities[0], tour_picks: [{ program_id: null, title: "جولة", text: "", price: 1, cars: 1 }] };
    // the first is on the day after arrival, the new one on the arrival day (in date order)
    expect(withTours(kl, 2, 2).map((p) => [p.title, p.cars])).toEqual([["", 2], ["جولة", 1]]);
    expect(withTours(kl, 2).map((p) => p.cars)).toEqual([undefined, 1]);
  });
});

describe("«جولة قبل المغادرة» — a tour on the day home", () => {
  /** KL two nights (20–21) then Langkawi two (22–23), home on the 24th; two vans for the tours. */
  function klTrip(): DraftData {
    const data = emptyDraftData();
    data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-20", nights: 4, days: 5, adults: 9 };
    data.cities = deriveCityDates("2026-10-20", [city("كوالالمبور", 2), city("لنكاوي", 2)]);
    data.transport_plan = { ...data.transport_plan, tours: { ...data.transport_plan.tours, car_type: "فان", cars: 2 } };
    data.days = draftDaySkeleton(data);
    return data;
  }
  const LGK: TourProgram = { id: "lgk", city_name: "لنكاوي", title: "جولة الجزر", description: "ثلاث جزر بالقارب", is_free_day: false, sort_order: 1 };
  const NO_LIST: PricingReference = { transfers: [], services: [], rooms: [], fleet: [], tours: [] };
  const toursTotal = (data: DraftData) =>
    suggestPricing(data, NO_LIST, { hotel: "فندق", airline: "الناقل" })
      .filter((i) => i.ref?.startsWith("tour:"))
      .reduce((sum, i) => sum + (i.sell_price ?? 0) * i.quantity, 0);
  const datesOn = (data: DraftData) => data.days.map((_, i) => dayTours(data, i)?.picks.map((p) => p.title) ?? null);

  it("an old generator file keeps every tour on its day and the day home as it was — even a date left on that day", () => {
    let data = klTrip();
    data.cities = data.cities.map((c, i) =>
      i === 0
        ? { ...c, tours: 1, tour_picks: [{ program_id: "kl1", title: "جولة المدينة", text: "برجا بتروناس", price: 300, date: "2026-10-21", cars: 2 }] }
        : {
            ...c,
            tours: 2,
            tour_picks: [
              { program_id: "lgk", title: "جولة الجزر", text: "ثلاث جزر بالقارب", price: 250, date: "2026-10-23", cars: 2 },
              // Langkawi was three nights once: this date is the day home now, and was never put there
              { program_id: null, title: "الشاطئ", text: "", price: 100, date: "2026-10-24" },
            ],
          },
    );
    data.days = daysFromTours(data);
    // saved, then opened again
    data = normalizeDraftData(JSON.parse(JSON.stringify(data)));
    expect(datesOn(data)).toEqual([[], ["جولة المدينة"], ["الشاطئ"], ["جولة الجزر"], []]);
    // the generator's day home is the agent's, and stays empty; nothing is rewritten on reopening
    expect([data.days[4].title, data.days[4].activities]).toEqual(["", []]);
    expect(daysFromTours(data)).toEqual(data.days);
    expect(toursTotal(data)).toBe(300 * 2 + 250 * 2 + 100);
  });

  it("a tour put on the day home prints first, then the way to the airport — priced, and one more than the nights", () => {
    const apply = (data: DraftData, slice: Pick<DraftData, "cities" | "days"> | null) => ({ ...data, ...slice! });
    let data = apply(klTrip(), withDayPick(klTrip(), 4, 0, { ...tourService("جولة الجزر", [LGK]), price: 250 }));
    expect(data.cities[1].tour_picks).toEqual([
      { program_id: "lgk", title: "جولة الجزر", text: "ثلاث جزر بالقارب", free: false, price: 250, cars: 2, date: "2026-10-24", departure: true },
    ]);
    expect([data.days[4].title, data.days[4].activities]).toEqual([
      "المغادرة",
      ["جولة الجزر: ثلاث جزر بالقارب", "التنقل بـفان × 2", "تسجيل الخروج من الفندق والتوجه إلى المطار للمغادرة"],
    ]);
    // both nights take a tour too: three tours in two nights
    data = apply(data, withDayPick(data, 2, 0, { title: "الشاطئ", price: 100 }));
    data = apply(data, withDayPick(data, 3, 0, { title: "الغابة", price: 100 }));
    expect([data.cities[1].tours, datesOn(data).slice(2)]).toEqual([3, [["الشاطئ"], ["الغابة"], ["جولة الجزر"]]]);
    expect(toursTotal(data)).toBe(250 * 2 + 100 * 2 + 100 * 2);
    // taken away, the day home is the agent's again, empty — as it was before
    const gone = apply(data, withDayPick(data, 4, 0, null));
    expect([gone.cities[1].tours, gone.days[4].title, gone.days[4].activities]).toEqual([2, "", []]);
  });

  it("follows the day home when the trip moves; on a city that is no longer the last it takes a night instead", () => {
    const lgk = { ...deriveCityDates("2026-10-21", klTrip().cities)[1], tour_picks: [{ program_id: null, title: "جولة الجزر", text: "", price: 250, date: "2026-10-24", departure: true }] };
    expect(withTours(lgk, 1, undefined, true)[0]).toMatchObject({ date: "2026-10-25", departure: true });
    expect(withTours(lgk, 1)[0]).toMatchObject({ date: "2026-10-24", departure: undefined });
  });
});
