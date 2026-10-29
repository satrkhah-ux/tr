import { describe, expect, it } from "vitest";
import { DEFAULT_HOURS, parseHours } from "@/lib/murad/reception";
import { businessMinutes, merge, parseHolidays, subtract, workingSpans } from "./business";

const at = (iso: string) => Date.parse(iso);
// Riyadh = UTC+3: 2026-10-29 (Thursday) 10:30 Riyadh = 07:30Z
const r = (day: string, hm: string) => at(`${day}T${hm}:00+03:00`);

describe("working time — the office's windows", () => {
  it("cuts a day into its windows (Thursday 10:30–12:30 and 16:00–00:00)", () => {
    const spans = workingSpans(DEFAULT_HOURS, r("2026-10-29", "00:00"), r("2026-10-30", "00:00"));
    expect(spans).toEqual([
      { from: r("2026-10-29", "10:30"), to: r("2026-10-29", "12:30") },
      { from: r("2026-10-29", "16:00"), to: r("2026-10-30", "00:00") },
    ]);
  });

  it("counts a late-night window past midnight, and a whole-day legacy window", () => {
    const late = parseHours("18:00-02:00");
    expect(workingSpans(late, r("2026-10-30", "00:00"), r("2026-10-30", "03:00"))).toEqual([{ from: r("2026-10-30", "00:00"), to: r("2026-10-30", "02:00") }]);
    expect(businessMinutes({ from: r("2026-10-29", "08:00"), to: r("2026-10-29", "10:00"), hours: parseHours("09:00-23:00"), holidays: [], excused: [] })).toBe(
      60,
    );
  });

  it("a client who wrote at 12:00 and was answered at 16:30 waited 60 working minutes, not 270", () => {
    expect(businessMinutes({ from: r("2026-10-29", "12:00"), to: r("2026-10-29", "16:30"), hours: DEFAULT_HOURS, holidays: [], excused: [] })).toBe(60);
  });

  it("takes out holidays, leaves and status buttons", () => {
    const from = r("2026-10-29", "16:00");
    const to = r("2026-10-29", "18:00");
    expect(businessMinutes({ from, to, hours: DEFAULT_HOURS, holidays: ["2026-10-29"], excused: [] })).toBe(0);
    const prayer = { from: r("2026-10-29", "17:00"), to: r("2026-10-29", "17:20"), reason: "prayer" as const };
    expect(businessMinutes({ from, to, hours: DEFAULT_HOURS, holidays: [], excused: [prayer] })).toBe(100);
    const leave = { from: r("2026-10-29", "00:00"), to: r("2026-10-30", "00:00"), reason: "leave" as const };
    expect(businessMinutes({ from, to, hours: DEFAULT_HOURS, holidays: [], excused: [leave, prayer] })).toBe(0);
  });
});

describe("spans", () => {
  it("merge joins overlaps, subtract leaves the uncovered parts", () => {
    expect(
      merge([
        { from: 5, to: 8 },
        { from: 1, to: 3 },
        { from: 2, to: 4 },
      ]),
    ).toEqual([
      { from: 1, to: 4 },
      { from: 5, to: 8 },
    ]);
    expect(
      subtract(
        [{ from: 0, to: 10 }],
        [
          { from: 2, to: 3 },
          { from: 5, to: 12 },
        ],
      ),
    ).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 },
    ]);
  });

  it("reads the holidays list, plain days or {day, name}", () => {
    expect(parseHolidays('["2026-12-02", {"day": "2026-09-23", "name": "اليوم الوطني"}, 5, "x"]')).toEqual(["2026-12-02", "2026-09-23"]);
    expect(parseHolidays("nope")).toEqual([]);
  });
});
