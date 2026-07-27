import { describe, expect, it } from "vitest";
import {
  FORECAST_HORIZON_DAYS,
  averageNormals,
  daysAhead,
  historicalDatesFor,
  shiftYears,
  splitDatesByHorizon,
  summarizeAr,
  weatherCodeAr,
  type DayWeather,
} from "./weather";

describe("daysAhead", () => {
  it("counts calendar days forward and backward", () => {
    expect(daysAhead("2026-07-20", "2026-07-20")).toBe(0);
    expect(daysAhead("2026-07-25", "2026-07-20")).toBe(5);
    expect(daysAhead("2026-07-15", "2026-07-20")).toBe(-5);
  });

  it("crosses months and years", () => {
    expect(daysAhead("2027-01-01", "2026-12-31")).toBe(1);
    expect(daysAhead("2026-03-01", "2026-02-28")).toBe(1); // 2026 is not a leap year
  });

  it("is NaN for malformed input rather than silently 0", () => {
    expect(Number.isNaN(daysAhead("nope", "2026-07-20"))).toBe(true);
  });
});

describe("splitDatesByHorizon", () => {
  const today = "2026-07-20";

  it("routes near dates to the forecast and far dates to the normals", () => {
    const { forecast, normals } = splitDatesByHorizon(["2026-07-21", "2027-03-10"], today);
    expect(forecast).toEqual(["2026-07-21"]);
    expect(normals).toEqual(["2027-03-10"]);
  });

  it("treats the last forecastable day as a forecast and the next as normals", () => {
    const edge = "2026-08-05"; // exactly FORECAST_HORIZON_DAYS ahead
    expect(daysAhead(edge, today)).toBe(FORECAST_HORIZON_DAYS);
    const { forecast, normals } = splitDatesByHorizon([edge, "2026-08-06"], today);
    expect(forecast).toEqual([edge]);
    expect(normals).toEqual(["2026-08-06"]);
  });

  it("sends past dates to normals — a forecast for yesterday is meaningless", () => {
    const { forecast, normals } = splitDatesByHorizon(["2026-07-19"], today);
    expect(forecast).toEqual([]);
    expect(normals).toEqual(["2026-07-19"]);
  });
});

describe("historicalDatesFor", () => {
  it("returns the same calendar day in each previous year", () => {
    expect(historicalDatesFor("2026-08-03", 3)).toEqual(["2025-08-03", "2024-08-03", "2023-08-03"]);
  });

  it("returns nothing for a malformed date", () => {
    expect(historicalDatesFor("2026-8-3")).toEqual([]);
  });
});

describe("shiftYears", () => {
  it("shifts back whole years", () => {
    expect(shiftYears("2026-08-03", 2)).toBe("2024-08-03");
  });

  it("applies day padding", () => {
    expect(shiftYears("2026-08-03", 1, -1)).toBe("2025-08-02");
    expect(shiftYears("2026-08-03", 1, 1)).toBe("2025-08-04");
  });

  it("never produces an invalid Feb 29 in a non-leap year", () => {
    // 2024-02-29 shifted back one year would be 2023-02-29 — the archive API
    // rejects that. Real-calendar arithmetic normalises it to March 1.
    const shifted = shiftYears("2024-02-29", 1);
    expect(shifted).toBe("2023-03-01");
    expect(Number.isNaN(Date.parse(`${shifted}T00:00:00Z`))).toBe(false);
  });

  it("pads across a month boundary", () => {
    expect(shiftYears("2026-03-01", 1, -1)).toBe("2025-02-28");
  });
});

describe("averageNormals", () => {
  it("averages temperatures and reports the share of wet years", () => {
    const day = averageNormals("2027-03-10", [
      { tmax: 30, tmin: 20, rain: 12.2 },
      { tmax: 32, tmin: 22, rain: 0 },
      { tmax: 34, tmin: 21, rain: 0.8 }, // under 1mm — not a wet day
      { tmax: 32, tmin: 21, rain: 5 },
    ]);
    expect(day.tempMax).toBe(32);
    expect(day.tempMin).toBe(21);
    expect(day.rainChance).toBe(50); // 2 of 4 years wet
    expect(day.source).toBe("normals");
    expect(day.code).toBeNull(); // an average has no single weather code
  });

  it("degrades to nulls when no year has data — never invents a number", () => {
    const day = averageNormals("2027-03-10", []);
    expect(day).toEqual({
      date: "2027-03-10",
      tempMax: null,
      tempMin: null,
      rainChance: null,
      code: null,
      source: "normals",
    });
  });

  it("ignores missing samples instead of counting them as zero", () => {
    const day = averageNormals("2027-03-10", [
      { tmax: 30, tmin: null, rain: null },
      { tmax: 40, tmin: 20, rain: 4 },
    ]);
    expect(day.tempMax).toBe(35);
    expect(day.tempMin).toBe(20);
    expect(day.rainChance).toBe(100); // only ONE year had rain data, and it was wet
  });
});

describe("weatherCodeAr", () => {
  it("maps the WMO bands we actually see", () => {
    expect(weatherCodeAr(0)).toBe("صحو");
    expect(weatherCodeAr(2)).toBe("غائم جزئيًا");
    expect(weatherCodeAr(3)).toBe("غائم");
    expect(weatherCodeAr(53)).toBe("رذاذ");
    expect(weatherCodeAr(65)).toBe("أمطار");
    expect(weatherCodeAr(95)).toBe("عواصف رعدية");
  });

  it("is empty for an unknown/absent code so the summary just omits it", () => {
    expect(weatherCodeAr(null)).toBe("");
  });
});

describe("summarizeAr", () => {
  const base: DayWeather = {
    date: "2026-07-21",
    tempMax: 31,
    tempMin: 24,
    rainChance: 96,
    code: 53,
    source: "forecast",
  };

  it("labels a forecast as a probability", () => {
    const text = summarizeAr(base);
    expect(text).toContain("31° / 24°");
    expect(text).toContain("رذاذ");
    expect(text).toContain("96% احتمال مطر");
  });

  it("labels normals as historical wet days — never as a forecast", () => {
    const text = summarizeAr({ ...base, code: null, source: "normals", rainChance: 40 });
    expect(text).toContain("40% أيام ممطرة");
    expect(text).not.toContain("احتمال مطر");
  });

  it("skips the parts it has no data for", () => {
    expect(summarizeAr({ ...base, tempMax: null, tempMin: null, code: null, rainChance: null })).toBe("");
  });
});
