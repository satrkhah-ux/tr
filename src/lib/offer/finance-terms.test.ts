import { describe, expect, it } from "vitest";
import { dueAmount, dueText, financeSection, type FinanceTerm } from "./finance-terms";

const t = (over: Partial<FinanceTerm>): FinanceTerm => ({ kind: "payment", text: "", country_id: null, checked: true, ...over });

describe("dueText", () => {
  it("before travel prints the date it falls on", () => {
    expect(dueText({ due_when: "before_travel", due_days: 30 }, "2026-12-20", "2026-10-29")).toBe("قبل السفر بـ 30 يوماً (2026-11-20)");
  });
  it("never a date before the offer is issued: due now", () => {
    expect(dueText({ due_when: "before_travel", due_days: 30 }, "2026-11-05", "2026-10-29")).toBe("قبل السفر بـ 30 يوماً (2026-10-29)");
  });
  it("confirmation milestones carry no date until there is one", () => {
    expect(dueText({ due_when: "confirm" }, "2026-12-20", "2026-10-29")).toBe("عند تأكيد الحجز");
    expect(dueText({ due_when: "after_confirm", due_days: 3 }, null, null)).toBe("خلال 3 أيام من تأكيد الحجز");
    expect(dueText({ due_when: "after_confirm", due_days: 1 }, null, null)).toBe("خلال يوم واحد من تأكيد الحجز");
  });
  it("no milestone: nothing", () => {
    expect(dueText({}, "2026-12-20", null)).toBeNull();
  });
});

describe("dueAmount", () => {
  it("a percent and what it comes to", () => {
    expect(dueAmount({ due_percent: 50 }, 6250, "SAR")).toBe("50% (3,125 SAR)");
    expect(dueAmount({ due_percent: 30 }, null, "SAR")).toBe("30%");
  });
  it("a fixed amount", () => {
    expect(dueAmount({ due_amount: 1000 }, 6250, "SAR")).toBe("1,000 SAR");
  });
});

describe("financeSection", () => {
  const terms: FinanceTerm[] = [
    t({ kind: "bank", text: "الراجحي — SA00 0000", checked: true }),
    t({ kind: "bank", text: "الأهلي — SA11 1111", checked: false }),
    t({ kind: "bank", text: "حساب ماليزيا", country_id: "my" }),
    t({ text: "العربون", due_when: "confirm", due_percent: 50 }),
    t({ text: "الباقي", due_when: "before_travel", due_days: 14, due_percent: 50 }),
    t({ text: "لا يُسترد العربون بعد إصدار التذاكر" }),
    t({ kind: "instalment", text: "التقسيط عبر تابي على 4 دفعات" }),
    t({ kind: "instalment", text: "تقسيط تركيا", country_id: "tr" }),
  ];
  const ctx = { countryId: "my", total: 10000, currency: "SAR", travelDate: "2026-12-20", issueDate: "2026-10-29" };
  it("ticked banks only, the trip country's and everyone's; milestones with dates and amounts", () => {
    expect(financeSection(terms, ctx)).toEqual({
      banks: ["الراجحي — SA00 0000", "حساب ماليزيا"],
      payments: ["العربون: عند تأكيد الحجز — 50% (5,000 SAR)", "الباقي: قبل السفر بـ 14 يوماً (2026-12-06) — 50% (5,000 SAR)", "لا يُسترد العربون بعد إصدار التذاكر"],
      instalment: ["التقسيط عبر تابي على 4 دفعات"],
    });
  });
  it("switching accounts is changing the ticks", () => {
    const swapped = terms.map((x) => (x.kind === "bank" && x.country_id === null ? { ...x, checked: !x.checked } : x));
    expect(financeSection(swapped, ctx).banks).toEqual(["الأهلي — SA11 1111", "حساب ماليزيا"]);
  });
});
