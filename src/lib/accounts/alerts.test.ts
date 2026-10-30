import { describe, expect, it } from "vitest";
import { financeAlerts, type AlertInput } from "./alerts";

const base: AlertInput = {
  today: "2026-10-20",
  month: "2026-10",
  expenses: { now: 1000, last: 1000 },
  sales: { now: 100000, last: 100000 },
  cases: [],
  late: [],
  unpaidBookings: [],
  sellers: [],
};

describe("«الإنذارات المالية»", () => {
  it("warns when expenses rise over 20% while sales do not — and stays quiet when sales rose too", () => {
    expect(financeAlerts({ ...base, expenses: { now: 1300, last: 1000 } }).map((a) => a.key)).toEqual(["expenses:2026-10"]);
    expect(financeAlerts({ ...base, expenses: { now: 1300, last: 1000 }, sales: { now: 120000, last: 100000 } })).toEqual([]);
    expect(financeAlerts({ ...base, expenses: { now: 1150, last: 1000 } })).toEqual([]);
  });

  it("flags this month's files at a loss or under 5% margin, with a decision to suggest", () => {
    const a = financeAlerts({ ...base, cases: [
      { id: "a", serial: "A-1", client: "عميل", month: "2026-10", sale: 10000, profit: -200 },
      { id: "b", serial: "B-2", client: "عميل", month: "2026-10", sale: 10000, profit: 400 },
      { id: "c", serial: "C-3", client: "عميل", month: "2026-10", sale: 10000, profit: 900 },
      { id: "d", serial: "D-4", client: "عميل", month: "2026-09", sale: 10000, profit: -900 },
    ] });
    expect(a.map((x) => [x.key, x.title])).toEqual([["margin:a", "🔻 ملف بخسارة: A-1"], ["margin:b", "🔻 هامش ضعيف (4.0%): B-2"]]);
    expect(a[0].decision?.text).toContain("أقل من 5%");
  });

  it("raises a client late more than 7 days, and a supplier booking due within 3 days (shown, sent by operations)", () => {
    const a = financeAlerts({ ...base,
      late: [{ id: "x", serial: "X", client: "عميل", seller: "بائع", due: 5000, lateDays: 8 }, { id: "y", serial: "Y", client: "عميل", seller: "", due: 5000, lateDays: 7 }],
      unpaidBookings: [
        { id: "b1", operation_id: "o", serial: "X", title: "فندق", supplier: "TBO", payBy: "2026-10-22", cost: 3000 },
        { id: "b2", operation_id: "o", serial: "X", title: "فندق", supplier: "TBO", payBy: "2026-10-25", cost: 3000 },
        { id: "b3", operation_id: "o", serial: "X", title: "فندق", supplier: "TBO", payBy: "2026-10-19", cost: 3000 },
      ] });
    expect(a.map((x) => [x.key, x.sentElsewhere ?? false])).toEqual([["supplier:b1:2026-10-22", true], ["late:x", false]]);
  });

  it("names the seller under half the target only once half the month is gone", () => {
    const sellers = [{ employee_id: "e1", name: "سالم", sales: 10000, target: 40000 }, { employee_id: "e2", name: "ريم", sales: 30000, target: 40000 }, { employee_id: "e3", name: "بلا هدف", sales: 0, target: null }];
    expect(financeAlerts({ ...base, today: "2026-10-14", sellers })).toEqual([]);
    const a = financeAlerts({ ...base, today: "2026-10-15", sellers });
    expect(a.map((x) => [x.key, x.title, x.decision?.employee_id])).toEqual([["target:e1:2026-10", "👤 سالم عند 25% من هدفه", "e1"]]);
  });
});
