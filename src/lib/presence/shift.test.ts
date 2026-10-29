import { describe, expect, it } from "vitest";
import { isWorkingTime, parseHours } from "@/lib/murad/reception";
import { activeShift, daysFromShift, readWindows, shiftFromDays } from "./shift";
import { businessMinutes } from "./business";

const row = (starts_on: string, ends_on: string | null, hours = "22:00-06:00") => ({ employee_id: "e", hours, starts_on, ends_on });

describe("a colleague's own shift", () => {
  it("the newest shift that covers the day, none before it starts or after it ends", () => {
    const rows = [row("2026-10-01", null, "09:00-17:00"), row("2026-10-29", "2026-11-05", "22:00-06:00")];
    expect(activeShift(rows, "2026-10-28")?.hours).toBe("09:00-17:00");
    expect(activeShift(rows, "2026-10-29")?.hours).toBe("22:00-06:00");
    expect(activeShift(rows, "2026-11-06")?.hours).toBe("09:00-17:00");
    expect(activeShift([row("2026-11-01", null)], "2026-10-29")).toBeNull();
  });

  it("reads a day's windows however they were typed", () => {
    expect(readWindows(" 16:00 – 00:00 ")).toEqual([{ open: "16:00", close: "00:00" }]);
    expect(readWindows("١٦:٠٠-٠٠:٠٠ 10:30-12:30")).toEqual([
      { open: "10:30", close: "12:30" },
      { open: "16:00", close: "00:00" },
    ]);
    expect(readWindows("")).toEqual([]);
    expect([readWindows("10-12"), readWindows("25:00-26:00"), readWindows("10:00-10:00")]).toEqual([null, null, null]);
  });

  it("turns seven days (Saturday first) into Murad's hours text, and back", () => {
    // a night shift Saturday–Wednesday, off Thursday and Friday
    const night = shiftFromDays(["22:00-06:00", "22:00-06:00", "22:00-06:00", "22:00-06:00", "22:00-06:00", "", ""]);
    expect(night).toEqual({ ok: true, hours: "السبت-الأربعاء 22:00-06:00" });
    if (!night.ok) throw new Error();
    expect(daysFromShift(night.hours)).toEqual(["22:00-06:00", "22:00-06:00", "22:00-06:00", "22:00-06:00", "22:00-06:00", "", ""]);
    // Wednesday 23:00 Riyadh works; Thursday 23:00 does not; Thursday 05:00 (the Wednesday night running on) works
    const h = parseHours(night.hours);
    expect(isWorkingTime(new Date("2026-10-28T20:00:00Z"), h)).toBe(true);
    expect(isWorkingTime(new Date("2026-10-29T20:00:00Z"), h)).toBe(false);
    expect(isWorkingTime(new Date("2026-10-29T02:00:00Z"), h)).toBe(true);
  });

  it("names the day it cannot read, and refuses a week with no working day", () => {
    expect(shiftFromDays(["22:00-06:00", "x", "", "", "", "", ""])).toEqual({
      ok: false,
      error: "لم أفهم دوام «الأحد». اكتبه هكذا: 16:00-00:00 أو 10:30-12:30 16:00-00:00",
    });
    expect(shiftFromDays(["", "", "", "", "", "", ""])).toMatchObject({ ok: false });
  });

  it("a night-shift colleague's waiting minutes count at night, not by the office's hours", () => {
    const night = parseHours("السبت-الأربعاء 22:00-06:00");
    // Wednesday 22:00 → Thursday 01:00 Riyadh
    const from = Date.parse("2026-10-28T19:00:00Z");
    const to = Date.parse("2026-10-28T22:00:00Z");
    expect(businessMinutes({ from, to, hours: night, holidays: [], excused: [] })).toBe(180);
  });
});
