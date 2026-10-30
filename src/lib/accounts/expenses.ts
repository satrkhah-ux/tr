/**
 * «المصروفات» — what the company spends outside the trips (stage 3, 2026-10-30): ads, bills, government
 * and bank fees, office costs. Salaries and rents are the owner's book («الحسابات المالية»), not here.
 * Pure: the form and the server check the same rules.
 */

export const EXPENSE_CATEGORIES = ["ads", "bills", "government", "bank", "office", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_CATEGORY_AR: Record<ExpenseCategory, string> = {
  ads: "إعلانات",
  bills: "فواتير (كهرباء، اتصالات، اشتراكات)",
  government: "رسوم حكومية",
  bank: "رسوم بنكية وعمولات الدفع",
  office: "مكتب وضيافة",
  other: "أخرى",
};
/** the same four ways as a supplier payment (supplier_payments.method) */
export const EXPENSE_METHODS = ["bank_transfer", "cash", "card", "other"] as const;
export type ExpenseMethod = (typeof EXPENSE_METHODS)[number];
export const EXPENSE_METHOD_AR: Record<ExpenseMethod, string> = { bank_transfer: "تحويل بنكي", cash: "كاش", card: "بطاقة", other: "أخرى" };

export type ExpenseInput = { spent_on: string; category: string; title: string; amount: number; method: string; note: string };
export type Expense = { id: string; spent_on: string; category: ExpenseCategory; title: string; amount: number; currency: string; method: ExpenseMethod; note: string | null };

/** null = fine; else the Arabic reason, shown as is */
export function expenseError(e: ExpenseInput, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.spent_on) || Number.isNaN(Date.parse(`${e.spent_on}T00:00:00Z`))) return "التاريخ غير صحيح.";
  if (e.spent_on > today) return "لا يُسجَّل مصروف بتاريخ لم يأتِ بعد.";
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(e.category)) return "اختر نوع المصروف.";
  if (!e.title.trim() || e.title.trim().length > 200) return "اكتب البند (200 حرف على الأكثر).";
  if (!(Number.isFinite(e.amount) && e.amount > 0 && e.amount <= 1e9)) return "المبلغ يجب أن يكون أكبر من صفر.";
  if (!(EXPENSE_METHODS as readonly string[]).includes(e.method)) return "اختر طريقة الدفع.";
  if (e.note.length > 1000) return "الملاحظة طويلة.";
  return null;
}

/** the month's riyal expenses, in total and by category (largest first) */
export function expenseTotals(list: Expense[], month: string): { total: number; byCategory: { category: ExpenseCategory; amount: number }[] } {
  const by = new Map<ExpenseCategory, number>();
  let total = 0;
  for (const e of list) {
    if (!e.spent_on.startsWith(month) || e.currency !== "SAR") continue;
    total += e.amount;
    by.set(e.category, (by.get(e.category) ?? 0) + e.amount);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { total: r2(total), byCategory: [...by].map(([category, amount]) => ({ category, amount: r2(amount) })).sort((a, b) => b.amount - a.amount) };
}
