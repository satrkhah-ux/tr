import { describe, expect, it } from "vitest";
import { clientDebts, employeeResults, periodOf, supplierSpend, toCsv, type ReportCase } from "./reports";

const c = (over: Partial<ReportCase>): ReportCase => ({
  id: "x", serial: "S", client: "عميل", seller: "بائع", employee_id: "e1", month: "2026-10", confirmed_on: "2026-10-01",
  travel_start: "2026-12-01", total: 10000, paid: 0, installments: [], profit: 1000, ...over,
});

describe("التقارير المالية", () => {
  it("reads a period as a month, or the last 3 / 12 months across the year end", () => {
    expect(periodOf("3m", "2026-02").months).toEqual(["2026-02", "2026-01", "2025-12"]);
    expect(periodOf("2026-11", "2026-10").months).toEqual(["2026-10"]); // a month to come is today's
    expect(periodOf(undefined, "2026-10").months).toEqual(["2026-10"]);
  });

  it("lists who owes: nothing paid first, then late on an installment, then the rest — each by how long late", () => {
    const { rows, totals } = clientDebts([
      c({ id: "paid", paid: 10000 }),
      c({ id: "unpaid", paid: 0, confirmed_on: "2026-10-30" }),
      c({ id: "unpaid-late", paid: 0, confirmed_on: "2026-10-25" }),
      c({ id: "part", paid: 5000, confirmed_on: "2026-10-30" }),
      c({ id: "late", paid: 2000, installments: [{ due_date: "2026-10-10", amount: 6000 }, { due_date: "2026-11-20", amount: 4000 }] }),
    ], "2026-10-30");
    expect(rows.map((r) => [r.id, r.state, r.due, r.lateDays])).toEqual([
      ["unpaid-late", "unpaid", 10000, 5],
      ["unpaid", "unpaid", 10000, 0],
      ["late", "overdue", 8000, 20],
      ["part", "remaining", 5000, 0],
    ]);
    expect(totals.overdue).toEqual({ count: 1, due: 8000 });
  });

  it("ranks suppliers and hotels by what their live bookings cost, beside what we paid", () => {
    const s = supplierSpend(
      [
        { kind: "hotel", title: "فندق أ", city: "تبليسي", supplier: "TBO", status: "confirmed", cost: 5000 },
        { kind: "hotel", title: "فندق أ", city: "تبليسي", supplier: "TBO", status: "confirmed", cost: 3000 },
        { kind: "flight", title: "الرياض ← تبليسي", city: null, supplier: "القافلة", status: "confirmed", cost: 9000 },
        { kind: "hotel", title: "فندق ب", city: "باتومي", supplier: "سمارت", status: "cancelled", cost: 7000 },
      ],
      [{ supplier: "TBO", amount: 6000, kind: "payment" }, { supplier: "TBO", amount: 1000, kind: "refund" }],
    );
    expect(s.suppliers).toEqual([{ name: "القافلة", booked: 9000, bookings: 1, paid: 0 }, { name: "TBO", booked: 8000, bookings: 2, paid: 5000 }]);
    expect(s.hotels).toEqual([{ name: "فندق أ — تبليسي", booked: 8000, bookings: 2 }]);
  });

  it("measures each seller against the period's targets — the month's own, else the standing one", () => {
    const rows = employeeResults({
      months: ["2026-10", "2026-09"],
      cases: [c({ employee_id: "e1", total: 30000, paid: 10000, profit: 4000 }), c({ employee_id: "e1", month: "2026-09", total: 20000, profit: 2000 }), c({ employee_id: "e2", total: 5000 }), c({ employee_id: "e2", month: "2026-07", total: 99999 })],
      names: { e1: "أحمد", e2: "سالم", e3: "ريم" },
      targets: [{ employee_id: "e1", month: null, amount: 40000 }, { employee_id: "e1", month: "2026-10", amount: 60000 }, { employee_id: "e2", month: null, amount: 20000 }],
      recordedBy: ["e3", "e3", "e1"],
    });
    expect(rows.map((r) => [r.name, r.confirmed, r.sales, r.profit, r.collected, r.target, r.achieved, r.recorded])).toEqual([
      ["أحمد", 2, 50000, 6000, 10000, 100000, 50, 1],
      ["سالم", 1, 5000, 1000, 0, 40000, 12.5, 0],
      ["ريم", 0, 0, 0, 0, null, null, 2],
    ]);
  });

  it("exports with the Arabic header", () => {
    expect(toCsv(["الاسم", "المبلغ"], [["أ, ب", 5]])).toBe('﻿الاسم,المبلغ\r\n"أ, ب",5');
  });
});
