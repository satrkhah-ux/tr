import { describe, expect, it } from "vitest";
import { expenseError, expenseTotals, type Expense } from "./expenses";

const ok = { spent_on: "2026-10-20", category: "ads", title: "حملة سناب", amount: 1500, method: "card", note: "" };

describe("«المصروفات»", () => {
  it("accepts a complete expense and names what is wrong otherwise", () => {
    expect(expenseError(ok, "2026-10-30")).toBeNull();
    expect(expenseError({ ...ok, spent_on: "2026-11-02" }, "2026-10-30")).toBe("لا يُسجَّل مصروف بتاريخ لم يأتِ بعد.");
    expect(expenseError({ ...ok, category: "salaries" }, "2026-10-30")).toBe("اختر نوع المصروف.");
    expect(expenseError({ ...ok, amount: 0 }, "2026-10-30")).toBe("المبلغ يجب أن يكون أكبر من صفر.");
    expect(expenseError({ ...ok, title: "  " }, "2026-10-30")).toBe("اكتب البند (200 حرف على الأكثر).");
  });
  it("adds the month's riyal expenses by category, largest first", () => {
    const e = (id: string, spent_on: string, category: Expense["category"], amount: number, currency = "SAR"): Expense => ({ id, spent_on, category, title: id, amount, currency, method: "cash", note: null });
    const t = expenseTotals([e("a", "2026-10-02", "ads", 1500), e("b", "2026-10-15", "bills", 600), e("c", "2026-10-20", "ads", 900), e("d", "2026-09-30", "ads", 5000), e("f", "2026-10-21", "bank", 50, "USD")], "2026-10");
    expect(t).toEqual({ total: 3000, byCategory: [{ category: "ads", amount: 2400 }, { category: "bills", amount: 600 }] });
  });
});
