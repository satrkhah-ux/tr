import { describe, expect, it } from "vitest";
import type { FinanceBook } from "@/lib/finance/model";
import { companyStatus, quarterOf } from "./status";

const book: FinanceBook = {
  updatedAt: "",
  reservePct: 20,
  rents: [{ id: "r", name: "مكتب", yearly: 12000, every: 3, startMonth: 10, note: "" }],
  staff: [{ id: "s", name: "أ", job: "", team: "", place: "", salary: 10000, note: "", stopFrom: "", startFrom: "" }],
  debts: [
    { id: "d1", creditor: "سيارات", kind: "installment", amount: 50000, monthly: 2000, payments: [{ id: "p", date: "2026-10-01", amount: 10000, note: "" }], note: "" },
    { id: "d2", creditor: "مورد", kind: "supplier", amount: 8000, monthly: 0, payments: [], note: "" },
    { id: "d3", creditor: "سُدّد", kind: "other", amount: 500, monthly: 0, payments: [{ id: "q", date: "2026-09-01", amount: 500, note: "" }], note: "" },
  ],
  bookings: [{ id: "b", date: "2026-08-01", title: "", seller: "", sale: 10000, cost: 5000, note: "" }],
  treasuryOut: [{ id: "o", date: "2026-09-01", title: "", amount: 400, note: "" }],
  partners: [{ id: "a", name: "أ", share: 60 }, { id: "b", name: "ب", share: 40 }],
  expenses: [],
  targets: [
    { id: "t1", month: "2026-11", sales: 100000, profit: 20000, debtBudget: 3000, focus: "سطر 1\n\nسطر 2", payments: "حامد" },
    { id: "t0", month: "2026-09", sales: 1, profit: 1, debtBudget: 0, focus: "", payments: "" },
  ],
};
const system = (m: string) => (({ "2026-10": { sales: 80000, profit: 16000, expenses: 1000 }, "2026-11": { sales: 50000, profit: 9000, expenses: 0 } }) as Record<string, { sales: number; profit: number; expenses: number }>)[m] ?? { sales: 0, profit: 0, expenses: 0 };

describe("«حالة الشركة»", () => {
  const s = companyStatus({ month: "2026-11", book, system });

  it("reads the treasury and the open debts from the book, largest first", () => {
    expect(s.treasury).toBe(1000 - 400);
    expect(s.debts).toEqual({ left: 48000, monthly: 2000, top: [{ creditor: "سيارات", left: 40000, monthly: 2000 }, { creditor: "مورد", left: 8000, monthly: 0 }] });
  });
  it("nets the month: sales profit less expenses less the book's fixed costs", () => {
    // November: salary 10000 + instalment 2000, no rent due (Oct/Jan)
    expect(s.net).toEqual({ month: 9000 - 0 - 12000, quarter: (16000 - 1000 - 15000) + (9000 - 12000), fixedMonth: 12000 });
    expect(s.breakEven).toEqual({ need: 15000, made: 9000, share: 60 });
  });
  it("splits the quarter so far after the treasury's 20% and every cost — nothing while it is negative", () => {
    // Q4 to November: profit 25000, treasury 5000, expenses 1000, fixed 15000 + 12000
    expect(s.split.distributable).toBe(25000 - 5000 - 1000 - 27000);
    expect(s.split.shares.map((x) => x.amount)).toEqual([0, 0]);
  });
  it("puts the plans from this month on against what the system recorded", () => {
    expect(s.plans).toEqual([{ month: "2026-11", sales: { target: 100000, actual: 50000, share: 50 }, profit: { target: 20000, actual: 9000, share: 45 }, debtBudget: 3000, focus: ["سطر 1", "سطر 2"], payments: ["حامد"] }]);
  });
  it("names the quarter", () => {
    expect(quarterOf("2026-11")).toEqual({ label: "الربع 4 — 2026", months: ["2026-10", "2026-11", "2026-12"] });
  });
});
