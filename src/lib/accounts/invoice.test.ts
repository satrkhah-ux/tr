import { describe, expect, it } from "vitest";
import { invoiceOf } from "./invoice";

const base = { serial: "AD-6-7901", confirmed_on: "2026-10-01", travel_start: "2026-12-01", total: 10000, paid: 0, installments: [], payments: [] };

describe("internal invoice", () => {
  it("numbers it from the file and owes the house terms when nothing was agreed", () => {
    const inv = invoiceOf(base, "2026-10-01");
    expect([inv.number, inv.status, inv.due, inv.terms]).toEqual(["INV-AD-6-7901", "due", 10000, "نصف المبلغ عند التأكيد، والباقي قبل السفر بـ14 يوماً"]);
    expect(inv.schedule.map((r) => [r.due_date, r.amount])).toEqual([["2026-10-01", 5000], ["2026-11-17", 5000]]);
  });
  it("is late once an agreed installment's day passed uncovered, and names the agreed ways", () => {
    const inv = invoiceOf(
      { ...base, paid: 4000, installments: [{ due_date: "2026-10-05", amount: 6000, note: "الوسيلة: تحويل بنكي" }, { due_date: "2026-11-20", amount: 4000, note: "الوسيلة: كاش" }] },
      "2026-10-10",
    );
    expect([inv.status, inv.due, inv.terms, inv.methods]).toEqual(["overdue", 6000, "على دفعتين حتى 2026-11-20", ["تحويل بنكي", "كاش"]]);
  });
  it("is partial while paid on time, naming how the money came when no agreement names it", () => {
    const inv = invoiceOf({ ...base, paid: 5000, payments: [{ amount: 5000, kind: "deposit", method: "pos" }, { amount: 100, kind: "refund", method: "cash" }] }, "2026-10-02");
    expect([inv.status, inv.methods]).toEqual(["partial", ["شبكة (مدى)"]]);
  });
  it("is settled when nothing is left, a single agreed payment reading as one", () => {
    const inv = invoiceOf({ ...base, paid: 10000, installments: [{ due_date: "2026-10-03", amount: 10000 }] }, "2026-10-20");
    expect([inv.status, inv.due, inv.terms]).toEqual(["paid", 0, "دفعة واحدة بتاريخ 2026-10-03"]);
  });
});
