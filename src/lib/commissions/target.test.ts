import { describe, expect, it } from "vitest";
import { daysLeftInMonth, isTargetQuestion, parseTargets, progress, riyadhMonthOf, targetFor, withTarget } from "./target";

describe("sales targets", () => {
  it("parses and drops bad entries", () => {
    const t = parseTargets(JSON.stringify({ monthly: { a: 50000, b: -1, c: "x" }, months: { "2026-11": { a: 70000 }, bad: { a: 1 }, "2026-12": { a: 0 } } }));
    expect(t).toEqual({ monthly: { a: 50000 }, months: { "2026-11": { a: 70000 } } });
    expect(parseTargets("not json")).toEqual({ monthly: {}, months: {} });
    expect(parseTargets(null)).toEqual({ monthly: {}, months: {} });
  });

  it("month override wins, else standing target, else null", () => {
    const t = parseTargets(JSON.stringify({ monthly: { a: 50000 }, months: { "2026-11": { a: 70000 } } }));
    expect(targetFor(t, "a", "2026-11")).toBe(70000);
    expect(targetFor(t, "a", "2026-10")).toBe(50000);
    expect(targetFor(t, "b", "2026-10")).toBeNull();
  });

  it("sets and clears without touching others", () => {
    const t0 = parseTargets(null);
    const t1 = withTarget(t0, "a", null, 40000.4)!;
    const t2 = withTarget(t1, "a", "2026-11", 60000)!;
    expect(t2).toEqual({ monthly: { a: 40000 }, months: { "2026-11": { a: 60000 } } });
    expect(t1.months).toEqual({});
    expect(withTarget(t2, "a", "2026-11", null)).toEqual({ monthly: { a: 40000 }, months: {} });
    expect(withTarget(t2, "a", "2026-13", 1)).toBeNull();
    expect(withTarget(t2, "a", null, -5)).toBeNull();
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
