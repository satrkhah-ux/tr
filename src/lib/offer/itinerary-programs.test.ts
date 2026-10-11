import { describe, expect, it } from "vitest";
import type { DraftDay } from "./draft-types";
import { fillDaysFromPrograms, isTouringDay, programDayText, type TourProgram } from "./itinerary";

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
