import { describe, expect, it } from "vitest";
import { deriveCityDates, emptyDraftData, type DraftData, type DraftDay } from "./draft-types";
import { draftDaySkeleton, fillDaysFromPrograms, isTouringDay, programDayText, withDayTour, type TourProgram } from "./itinerary";

const day = (n: number, city: string, title = ""): DraftDay => ({
  day_number: n,
  date: null,
  city_name: city,
  title,
  activities: [],
  weather: null,
  ai_generated: false,
});

const program = (id: string, city: string, order: number, title: string, free = false): TourProgram => ({
  id,
  city_name: city,
  title,
  description: `وصف ${title}`,
  is_free_day: free,
  sort_order: order,
});

describe("ready-made day programmes", () => {
  // KL ×3 then Langkawi ×3: day 1 arrival, day 4 city change, day 6 home
  const days = [
    day(1, "كوالالمبور"),
    day(2, "كوالالمبور"),
    day(3, "كوالالمبور", "يوم كتبه الموظف"),
    day(4, "لنكاوي"),
    day(5, "لنكاوي"),
    day(6, "لنكاوي"),
  ];
  const programs = [
    program("a", "كوالالمبور", 1, "الجولة الأولى"),
    program("b", "كوالالمبور", 2, "الجولة الثانية"),
    program("f", "لنكاوي", 0, "يوم حر", true),
    program("c", "لنكاوي", 1, "جولة بحرية"),
  ];

  it("only arrival-free, same-city middle days are touring days", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => isTouringDay(days, i))).toEqual([false, true, true, false, true, false]);
  });

  it("fills empty touring days in order, never over written text, never with a free day", () => {
    const { days: out, filled } = fillDaysFromPrograms(days, programs);
    expect(filled).toBe(2);
    expect(out[1].title).toBe("الجولة الأولى في كوالالمبور");
    expect(out[2].title).toBe("يوم كتبه الموظف");
    expect(out[4].title).toBe("جولة بحرية");
    expect(out[0].title).toBe("");
    expect(out[5].title).toBe("");
  });

  it("names a generic ordinal tour after its city, keeps a specific one as is", () => {
    expect(programDayText(programs[0]).title).toBe("الجولة الأولى في كوالالمبور");
    expect(programDayText(programs[3]).title).toBe("جولة بحرية");
  });
});

describe("«اختر جولة جاهزة» writes a real tour (الأمر 3)", () => {
  /** KL 20–22 Oct then Langkawi 22–24, nine people in two vans. */
  function trip(): DraftData {
    const data = emptyDraftData();
    data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-20", nights: 4, days: 5, adults: 9 };
    data.cities = deriveCityDates("2026-10-20", [
      { city_name: "كوالالمبور", nights: 2, check_in: null, check_out: null },
      { city_name: "لنكاوي", nights: 2, check_in: null, check_out: null },
    ]);
    data.transport_plan = { ...data.transport_plan, tours: { ...data.transport_plan.tours, car_type: "فان", cars: 2 } };
    data.days = draftDaySkeleton(data);
    return data;
  }
  const first = program("p1", "كوالالمبور", 1, "الجولة الأولى");
  const second = program("p2", "كوالالمبور", 2, "جولة المدينة");

  it("picks the tour for its city on that day, in the trip's tour cars, to be priced from the lists", () => {
    const next = withDayTour(trip(), 1, first)!;
    expect(next.cities[0].tours).toBe(1);
    expect(next.cities[0].tour_picks).toEqual([
      { program_id: "p1", title: "الجولة الأولى في كوالالمبور", text: "وصف الجولة الأولى", price: null, date: "2026-10-21", cars: 2 },
    ]);
    expect(next.cities[1].tour_picks).toBeUndefined();
    expect(next.days[1].title).toBe("الجولة الأولى في كوالالمبور");
  });

  it("replaces the day's tour with another, and keeps a free-day programme free", () => {
    let data = trip();
    data = { ...data, ...withDayTour(data, 1, first)! };
    data = { ...data, ...withDayTour(data, 1, second)! };
    expect(data.cities[0].tour_picks?.map((p) => p.program_id)).toEqual(["p2"]);
    expect(data.days[1].title).toBe("جولة المدينة");

    data = { ...data, ...withDayTour(data, 1, program("f", "كوالالمبور", 0, "يوم حر", true))! };
    expect(data.cities[0].tour_picks?.map((p) => [p.free, p.cars])).toEqual([[true, undefined]]);
    expect([data.days[1].title, data.days[1].activities]).toEqual(["يوم حر", ["وصف يوم حر"]]);
  });

  it("the day home takes a tour only as the last city's «جولة قبل المغادرة»; a sale without tours keeps the text alone", () => {
    const data = trip();
    const home = withDayTour(data, 4, program("l1", "لنكاوي", 1, "جولة بحرية"))!;
    expect(home.cities[1].tour_picks).toEqual([
      { program_id: "l1", title: "جولة بحرية", text: "وصف جولة بحرية", price: null, date: "2026-10-24", cars: 2, departure: true },
    ]);
    expect([home.days[4].title, home.days[4].activities]).toEqual([
      "المغادرة",
      ["جولة بحرية: وصف جولة بحرية", "التنقل بـفان × 2", "تسجيل الخروج من الفندق والتوجه إلى المطار للمغادرة"],
    ]);
    const noTours = { ...data, transport_plan: { ...data.transport_plan, tours: { ...data.transport_plan.tours, enabled: false } } };
    expect(withDayTour(noTours, 1, first)).toBeNull();
  });
});
