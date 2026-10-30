/**
 * «كيف تم الاتفاق المالي؟» (the owner, 2026-10-30) — asked when the client
 * confirms: one payment, or installments, each on a date and by one of our
 * ways of paying, every one before the trip. Pure and clock-injected, like
 * payments.ts: the confirm dialog and the server check the same rules.
 *
 * Amounts are OUR price (the offer before any method's charge); what the
 * client actually pays on a row is that share quoted by its method
 * (methods.ts quoteMethod) — the schedule stores that, so the case's total and
 * reminders are what the client owes. Never a fee or a % in client text.
 */

import { isBnpl, isPayMethod, PAY_METHOD_AR, quoteMethod, type PaymentFees, type PayMethod } from "@/lib/payments/methods";
import { isIsoDate } from "./payments";

export type AgreementRow = { due_date: string; amount: number; method: PayMethod | null };
/** `later`: confirmed without one — the case says «لم يُحدَّد الاتفاق المالي» until it is set. */
export type Agreement = { kind: "later" } | { kind: "single" | "plan"; rows: AgreementRow[] };
export type AgreementError = "rows" | "amount" | "date" | "method" | "past" | "afterTravel" | "sum" | "bnplSplit";

const MAX_ROWS = 24;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** The last day a payment may fall on: the day before travel (null = travel date unknown). */
export const lastPayDay = (travelStart: string | null): string | null => (travelStart && isIsoDate(travelStart) ? addDays(travelStart, -1) : null);

export function validateAgreement(rows: AgreementRow[], ctx: { base: number; travelStart: string | null; today: string }): AgreementError | null {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS) return "rows";
  const last = lastPayDay(ctx.travelStart);
  for (const r of rows) {
    if (!(Number.isFinite(r.amount) && r.amount > 0)) return "amount";
    if (!isIsoDate(r.due_date)) return "date";
    if (r.method !== null && !isPayMethod(r.method)) return "method";
    if (r.due_date < ctx.today) return "past";
    if (last && r.due_date > last) return "afterTravel";
  }
  // Tabby / Tamara: the provider takes the whole amount and does the installments itself
  if (rows.length > 1 && rows.some((r) => isBnpl(r.method))) return "bnplSplit";
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  if (Math.abs(sum - ctx.base) > 0.005) return "sum";
  return null;
}

/** `total` in `n` equal parts to the halala; the last part takes the rounding. */
export function splitEqual(total: number, n: number): number[] {
  if (!(n >= 1) || !(total > 0)) return [];
  const part = Math.floor((total * 100) / n) / 100;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? round2(total - part * (n - 1)) : part));
}

/** `n` dates from `today` to `last`, evenly spread (all today when there is no room, or no travel date). */
export function spreadDates(today: string, last: string | null, n: number): string[] {
  if (n <= 1 || !last || last <= today) return Array.from({ length: Math.max(n, 1) }, () => today);
  const span = Math.round((Date.parse(last) - Date.parse(today)) / 86_400_000);
  return Array.from({ length: n }, (_, i) => addDays(today, Math.round((span * i) / (n - 1))));
}

/** What the client pays on a row: its share quoted by its method; the share itself when no fees apply. */
export function clientAmount(amount: number, method: PayMethod | null, fees: PaymentFees | null): number {
  if (!method || !fees) return round2(amount);
  const q = quoteMethod(amount, method, fees);
  return q.unset ? round2(amount) : q.total;
}

/** The installment's note — how it is paid, in the words every paper uses. */
export const methodNote = (method: PayMethod | null): string | null => (method ? `الوسيلة: ${PAY_METHOD_AR[method]}` : null);

/** The schedule rows saveInstallments stores for an agreement. */
export function scheduleOf(rows: AgreementRow[], fees: PaymentFees | null): { due_date: string; amount: number; note: string | null }[] {
  return rows.map((r) => ({ due_date: r.due_date, amount: clientAmount(r.amount, r.method, fees), note: methodNote(r.method) }));
}

/**
 * The morning's reminder for an unpaid installment (daily.ts, sent once each):
 * «soon» three days before its date, «today» on it — after that it is overdue,
 * which daily.ts already says.
 */
export function dueReminder(row: { due_date: string | null; state: string }, today: string): "soon" | "today" | null {
  if (!row.due_date || row.state === "paid" || row.state === "overdue") return null;
  return row.due_date === today ? "today" : row.due_date === addDays(today, 3) ? "soon" : null;
}
