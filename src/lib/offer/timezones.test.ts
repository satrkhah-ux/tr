import { describe, expect, it } from "vitest";
import {
  arrivalDayNoteAr,
  arrivalPart,
  dayOneIsUsable,
  dayShiftNoteAr,
  describeOffsetAr,
  offsetFromHome,
} from "./timezones";

/**
 * The case that started this: a client leaves Jeddah on the 26th and the
 * programme has to know which local day they actually land on.
 */
describe("offsetFromHome", () => {
  it("puts the Far East ahead of Saudi", () => {
    expect(offsetFromHome("Asia/Kuala_Lumpur", "2026-08-26")).toBe(5);
    expect(offsetFromHome("Asia/Bangkok", "2026-08-26")).toBe(4);
    expect(offsetFromHome("Asia/Tokyo", "2026-08-26")).toBe(6);
  });

  it("puts the Americas behind it", () => {
    expect(offsetFromHome("America/New_York", "2026-08-26")).toBe(-7);
  });

  it("MOVES with daylight saving — which is why it is computed, not stored", () => {
    // Berlin is CEST (UTC+2) in July against Riyadh's fixed UTC+3 → −1, and
    // CET (UTC+1) in January → −2. A number stored on the country row would be
    // wrong for half of every year.
    expect(offsetFromHome("Europe/Berlin", "2026-07-15")).toBe(-1);
    expect(offsetFromHome("Europe/Berlin", "2026-01-15")).toBe(-2);
    // Saudi keeps one offset all year, so the whole change comes from the far end.
    expect(offsetFromHome("Europe/London", "2026-07-15")).toBe(-2);
    expect(offsetFromHome("Europe/London", "2026-01-15")).toBe(-3);
  });

  it("says nothing rather than something wrong for an unusable zone", () => {
    expect(offsetFromHome(null)).toBeNull();
    expect(offsetFromHome("Not/AZone", "2026-08-26")).toBeNull();
  });

  it("reads the Gulf as no difference at all", () => {
    expect(offsetFromHome("Asia/Qatar", "2026-08-26")).toBe(0);
    expect(describeOffsetAr(0)).toBe("لا فرق توقيت مع السعودية");
  });
});

describe("describeOffsetAr", () => {
  it("names the direction, not just the number", () => {
    expect(describeOffsetAr(5)).toContain("تسبق");
    expect(describeOffsetAr(-7)).toContain("تتأخّر");
  });

  it("counts hours the way Arabic does", () => {
    expect(describeOffsetAr(1)).toContain("ساعة");
    expect(describeOffsetAr(2)).toContain("ساعتان");
    expect(describeOffsetAr(5)).toContain("5 ساعات");
  });

  it("handles the half-hour zones", () => {
    // India is +2:30 from Riyadh — a whole number would be a lie.
    expect(offsetFromHome("Asia/Kolkata", "2026-08-26")).toBe(2.5);
    expect(describeOffsetAr(2.5)).toContain("30 دقيقة");
  });
});

describe("arrival time of day", () => {
  it("knows a 04:00 landing buys no touring", () => {
    expect(arrivalPart("2026-08-27T04:10")).toBe("late_night");
    expect(dayOneIsUsable("2026-08-27T04:10")).toBe(false);
    expect(arrivalDayNoteAr("2026-08-27T04:10")).toContain("لا جولات");
  });

  it("knows a 23:40 landing buys none either", () => {
    expect(dayOneIsUsable("2026-08-26T23:40")).toBe(false);
  });

  it("leaves a morning landing as a real day", () => {
    expect(arrivalPart("2026-08-27T09:15")).toBe("morning");
    expect(dayOneIsUsable("2026-08-27T09:15")).toBe(true);
    expect(arrivalDayNoteAr("2026-08-27T09:15")).toBe("الوصول صباحاً");
  });

  it("assumes a usable day when the time is unknown, rather than warning wrongly", () => {
    expect(dayOneIsUsable(null)).toBe(true);
    expect(arrivalDayNoteAr(null)).toBeNull();
  });
});

describe("dayShiftNoteAr", () => {
  it("is silent for a flight that lands the same day", () => {
    expect(dayShiftNoteAr(0)).toBeNull();
  });

  it("explains the next-day landing — the common eastbound case", () => {
    expect(dayShiftNoteAr(1)).toContain("اليوم التالي");
  });

  it("flags the previous-day landing as something to check", () => {
    // Physically possible only crossing the date line eastward, so from here it
    // is almost always a typo in the arrival date — say so.
    expect(dayShiftNoteAr(-1)).toContain("تحقّق");
  });
});
