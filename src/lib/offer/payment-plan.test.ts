import { describe, expect, it } from "vitest";
import { cleanPlan, dueDates, planGap, planLines, refundLines, splitDues, suggestDeposit } from "./payment-plan";
import { emptyFinance, hasFinance, withFileTerms } from "./finance-terms";

describe("payment plan", () => {
  it("suggests the profit rounded up to the next 500, never under 500", () => {
    expect(suggestDeposit(1230)).toBe(1500);
    expect(suggestDeposit(1500)).toBe(1500);
    expect(suggestDeposit(1501)).toBe(2000);
    expect(suggestDeposit(0)).toBe(500);
    expect(suggestDeposit(-300)).toBe(500);
  });

  it("dates the dues on the deadlines still ahead, once each, earliest first", () => {
    expect(dueDates(["2026-12-01", null, "2026-11-10", "2026-12-01", "2026-10-01", "bad"], "2026-10-31")).toEqual(["2026-11-10", "2026-12-01"]);
  });

  it("splits the rest in whole riyals, the last taking what is left, and undated beyond the dates", () => {
    const p = splitDues(10_000.5, 1_500, ["2026-11-10"], 3);
    expect(p).toEqual([
      { date: "2026-11-10", amount: 2833 },
      { date: null, amount: 2833 },
      { date: null, amount: 2834.5 },
    ]);
    expect(planGap(10_000.5, { deposit: { amount: 1_500, refundable: false, note: "" }, payments: p })).toBe(0);
  });

  it("says how much is short or over", () => {
    const plan = { deposit: { amount: 1_000, refundable: false, note: "" }, payments: [{ date: null, amount: 3_000 }] };
    expect(planGap(5_000, plan)).toBe(1_000);
    expect(planGap(3_500, plan)).toBe(-500);
  });

  it("prints amounts and dates for the client — never a profit", () => {
    const lines = planLines({ deposit: { amount: 1500, refundable: false, note: "تُخصم من الإجمالي" }, payments: [{ date: "2026-11-10", amount: 4000 }, { date: null, amount: 2500 }] }, "SAR");
    expect(lines).toEqual([
      "الدفعة الأولى لتثبيت الحجز: 1,500 ريال (غير مسترجعة) — تُخصم من الإجمالي",
      "الدفعة الثانية: 4,000 ريال — حتى 2026-11-10",
      "الدفعة الثالثة: 2,500 ريال — قبل السفر",
    ]);
    expect(lines.join(" ")).not.toMatch(/ربح|أرباح/);
  });

  it("keeps a stored plan only as far as it is well formed", () => {
    expect(cleanPlan({ deposit: { amount: "x" }, payments: [] })).toBeUndefined();
    expect(cleanPlan({ deposit: null, payments: [{ date: "soon", amount: 100 }, { amount: -1 }] })).toEqual({ deposit: null, payments: [{ date: null, amount: 100 }] });
  });

  it("puts the file's plan in place of the standing milestones and the hotels' refund terms beside them", () => {
    const base = { ...emptyFinance(), payments: ["50% عند التأكيد"] };
    const hotels = [{ hotel_name: "Hilton", cancellation_policy: "قابل للاسترداد حتى 2026-11-10" }, { hotel_name: "Hilton", cancellation_policy: "قابل للاسترداد حتى 2026-11-10" }, { hotel_name: "X", cancellation_policy: null }];
    expect(refundLines(hotels)).toEqual(["Hilton: قابل للاسترداد حتى 2026-11-10"]);
    const out = withFileTerms(base, { deposit: { amount: 500, refundable: true, note: "" }, payments: [] }, "SAR", hotels);
    expect(out.payments).toEqual(["الدفعة الأولى لتثبيت الحجز: 500 ريال (مسترجعة)"]);
    expect(withFileTerms(base, undefined, "SAR", []).payments).toEqual(["50% عند التأكيد"]);
    expect(hasFinance({ ...emptyFinance(), refunds: ["Hilton: غير قابل للاسترداد"] })).toBe(true);
  });
});
