import { describe, expect, it } from "vitest";
import { daysLeftInMonth, isTargetAmount, isTargetMonth, isTargetQuestion, progress, riyadhMonthOf, rowsToTargets, targetFor } from "./target";

describe("sales targets", () => {
  const rows = [
    { employee_id: "a", month: null, amount: "50000.00" },
    { employee_id: "a", month: "2026-11-01", amount: 70000 },
    { employee_id: "b", month: null, amount: -1 },
    { employee_id: "c", month: "2026-13-01", amount: 1000 },
  ];

  it("rows → lookup, bad rows dropped", () => {
    expect(rowsToTargets(rows)).toEqual({ monthly: { a: 50000 }, months: { "2026-11": { a: 70000 } } });
    expect(rowsToTargets([])).toEqual({ monthly: {}, months: {} });
  });

  it("month override wins, else standing target, else null", () => {
    const t = rowsToTargets(rows);
    expect(targetFor(t, "a", "2026-11")).toBe(70000);
    expect(targetFor(t, "a", "2026-10")).toBe(50000);
    expect(targetFor(t, "b", "2026-10")).toBeNull();
  });

  it("validates what the manager types", () => {
    expect(isTargetAmount(40000)).toBe(true);
    expect(isTargetAmount(0)).toBe(false);
    expect(isTargetAmount(-5)).toBe(false);
    expect(isTargetAmount(Number.NaN)).toBe(false);
    expect(isTargetAmount(100_000_001)).toBe(false);
    expect(isTargetMonth("2026-11")).toBe(true);
    expect(isTargetMonth("2026-13")).toBe(false);
  });

  it("progress: whole percent, bar capped, nothing without a target", () => {
    expect(progress(25000, 50000)).toEqual({ pct: 50, bar: 50, left: 25000 });
    expect(progress(49999, 50000)?.pct).toBe(99);
    expect(progress(75000, 50000)).toEqual({ pct: 150, bar: 100, left: 0 });
    expect(progress(0, 50000)).toEqual({ pct: 0, bar: 0, left: 50000 });
    expect(progress(100, null)).toBeNull();
    expect(progress(100, 0)).toBeNull();
  });

  it("month boundaries follow Riyadh, not UTC", () => {
    expect(riyadhMonthOf(Date.parse("2026-10-31T20:59:00Z"))).toBe("2026-10");
    expect(riyadhMonthOf(Date.parse("2026-10-31T21:00:00Z"))).toBe("2026-11");
    expect(daysLeftInMonth(Date.parse("2026-10-31T10:00:00Z"))).toBe(1);
    expect(daysLeftInMonth(Date.parse("2026-02-01T10:00:00Z"))).toBe(28);
  });

  it("target questions go to the employee's figures", () => {
    expect(isTargetQuestion("كيف أصل إلى هدفي هذا الشهر؟")).toBe(true);
    expect(isTargetQuestion("كم عمولتي")).toBe(true);
    expect(isTargetQuestion("كيف أنشئ بكج جديد؟")).toBe(false);
  });
});
