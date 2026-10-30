/**
 * «أهداف المبيعات» (the owner, 2026-10-30): each seller's monthly sales target
 * in riyals, typed by the administration in «العمولات» → «أهداف المبيعات».
 * One standing target per employee, and an optional override for a given month.
 * Stored as JSON in app_settings («sales_targets»). Pure: tested without a database.
 *
 * Achieved = «العمولات»'s own monthly sales (commissionMonth): the revenue of the
 * files whose client finished paying this month.
 */

export const SALES_TARGETS_KEY = "sales_targets";
export const MAX_TARGET = 100_000_000;

export type SalesTargets = {
  /** employee id → standing monthly target (SAR) */
  monthly: Record<string, number>;
  /** "YYYY-MM" → employee id → that month's target (SAR) */
  months: Record<string, Record<string, number>>;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const okAmount = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_TARGET;

function cleanMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => okAmount(e[1])));
}

/** whatever is stored (or nothing) → a clean value; a bad entry is dropped, never guessed */
export function parseTargets(raw: string | null | undefined): SalesTargets {
  let v: unknown = null;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    v = null;
  }
  const o = (v && typeof v === "object" ? v : {}) as { monthly?: unknown; months?: unknown };
  const months: SalesTargets["months"] = {};
  if (o.months && typeof o.months === "object") {
    for (const [m, map] of Object.entries(o.months as Record<string, unknown>)) {
      const clean = cleanMap(map);
      if (MONTH.test(m) && Object.keys(clean).length) months[m] = clean;
    }
  }
  return { monthly: cleanMap(o.monthly), months };
}

/** the month's override, else the standing target, else null (no target set) */
export function targetFor(t: SalesTargets, employeeId: string, month: string): number | null {
  return t.months[month]?.[employeeId] ?? t.monthly[employeeId] ?? null;
}

/**
 * Set or clear (amount null) one target. month null = the standing target.
 * Returns null when the input is invalid.
 */
export function withTarget(t: SalesTargets, employeeId: string, month: string | null, amount: number | null): SalesTargets | null {
  if (!employeeId || (month !== null && !MONTH.test(month)) || (amount !== null && !okAmount(amount))) return null;
  const next: SalesTargets = { monthly: { ...t.monthly }, months: Object.fromEntries(Object.entries(t.months).map(([m, map]) => [m, { ...map }])) };
  const map = month === null ? next.monthly : (next.months[month] ??= {});
  if (amount === null) delete map[employeeId];
  else map[employeeId] = Math.round(amount);
  if (month !== null && !Object.keys(next.months[month]).length) delete next.months[month];
  return next;
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
