/**
 * «أهداف المبيعات» (the owner, 2026-10-30): each seller's monthly sales target
 * in riyals, typed by the administration in «العمولات» → «أهداف المبيعات».
 * One standing target per employee, and an optional override for a given month.
 * Stored in public.sales_targets (20261030100000, closed: service client after currentCan).
 * Pure: tested without a database.
 *
 * Achieved = «العمولات»'s own monthly sales (commissionMonth): the revenue of the
 * files whose client finished paying this month.
 */

export const MAX_TARGET = 100_000_000;

export type SalesTargets = {
  /** employee id → standing monthly target (SAR) */
  monthly: Record<string, number>;
  /** "YYYY-MM" → employee id → that month's target (SAR) */
  months: Record<string, Record<string, number>>;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isTargetAmount = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_TARGET;
export const isTargetMonth = (m: unknown): m is string => typeof m === "string" && MONTH.test(m);

export type SalesTargetRow = { employee_id: string; month: string | null; amount: number | string };

/** the table's rows → the lookup shape; month is a date ("YYYY-MM-01") or null; a bad row is dropped, never guessed */
export function rowsToTargets(rows: readonly SalesTargetRow[]): SalesTargets {
  const t: SalesTargets = { monthly: {}, months: {} };
  for (const r of rows) {
    const amount = Number(r.amount);
    if (!isTargetAmount(amount)) continue;
    if (r.month === null) t.monthly[r.employee_id] = amount;
    else if (isTargetMonth(r.month.slice(0, 7))) (t.months[r.month.slice(0, 7)] ??= {})[r.employee_id] = amount;
  }
  return t;
}

/** the month's override, else the standing target, else null (no target set) */
export function targetFor(t: SalesTargets, employeeId: string, month: string): number | null {
  return t.months[month]?.[employeeId] ?? t.monthly[employeeId] ?? null;
}

/** share of the target reached: pct as a whole number (may pass 100), bar capped 0–100 for the progress bar */
export function progress(sales: number, target: number | null): { pct: number; bar: number; left: number } | null {
  if (!target || target <= 0) return null;
  const pct = Math.max(0, Math.floor((sales / target) * 100));
  return { pct, bar: Math.min(100, pct), left: Math.max(0, Math.round((target - sales) * 100) / 100) };
}

/** the Riyadh calendar month ("YYYY-MM") of a moment — a file paid at 01:00 Riyadh on the 1st belongs to the new month */
export const riyadhMonthOf = (ms: number) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 7);

/** days left in the Riyadh month, today included */
export function daysLeftInMonth(ms: number): number {
  const d = new Date(ms + 3 * 3600_000);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return last - d.getUTCDate() + 1;
}

/** «هدف / مبيعات / عمولة» — a question about the employee's own target, answered from their figures, not from the guide */
export const isTargetQuestion = (q: string) => /(هدفي|عمولتي|مبيعاتي|هدفك|عمولتك|مبيعاتك)/.test(q);
