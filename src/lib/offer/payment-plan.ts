/**
 * «خطة الدفع» (the owner, 2026-10-31): the file's own agreement with the client — an optional first payment that
 * holds the booking («الدفعة الأولى لتثبيت الحجز»: the profit, rounded up to the next 500, refundable or not, with a
 * note), then the rest spread over dates (the hotels' refund deadlines by default), every figure editable. Printed
 * under «الشروط المالية» as amounts and dates only — never the profit it was worked out from.
 *
 * Pure: no database, no clock.
 */

export type PlanPayment = { date: string | null; amount: number };
export type PaymentPlan = {
  deposit: { amount: number; refundable: boolean; note: string } | null;
  payments: PlanPayment[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);

/** A stored plan as it may come back from the draft's jsonb — anything malformed is dropped, never guessed. */
export function cleanPlan(raw: unknown): PaymentPlan | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { deposit?: unknown; payments?: unknown };
  const d = r.deposit as { amount?: unknown; refundable?: unknown; note?: unknown } | null | undefined;
  const amount = d ? num(d.amount) : null;
  const deposit = d && amount !== null ? { amount, refundable: d.refundable === true, note: typeof d.note === "string" ? d.note.slice(0, 200) : "" } : null;
  const payments = (Array.isArray(r.payments) ? r.payments : [])
    .map((p: { date?: unknown; amount?: unknown }) => ({ date: typeof p?.date === "string" && DAY.test(p.date) ? p.date : null, amount: num(p?.amount) }))
    .filter((p): p is PlanPayment => p.amount !== null)
    .slice(0, 24);
  return deposit || payments.length ? { deposit, payments } : undefined;
}

/** «الأرباح + التقريب لأقرب 500»: the profit rounded up to the next 500 — at least 500. */
export const suggestDeposit = (profit: number): number => Math.max(500, Math.ceil(Math.max(0, profit) / 500) * 500);

/** The dates the dues fall on: the hotels' refund / pay-by deadlines from today on, once each, earliest first. */
export function dueDates(deadlines: (string | null | undefined)[], today: string): string[] {
  return [...new Set(deadlines.filter((d): d is string => typeof d === "string" && DAY.test(d) && d >= today))].sort();
}

/**
 * The rest after the first payment, in `count` equal whole-riyal payments (the last takes what is left), on the
 * given dates in order; a payment beyond the dates has none («قبل السفر»).
 */
export function splitDues(total: number, deposit: number, dates: string[], count: number): PlanPayment[] {
  const n = Math.max(1, Math.min(24, Math.trunc(count) || 1));
  const rest = Math.max(0, Math.round((total - deposit) * 100) / 100);
  const each = Math.floor(rest / n);
  return Array.from({ length: n }, (_, i) => ({
    date: dates[i] ?? null,
    amount: i === n - 1 ? Math.round((rest - each * (n - 1)) * 100) / 100 : each,
  }));
}

/** total − (first payment + payments): 0 = they agree; > 0 short; < 0 over. */
export function planGap(total: number, plan: PaymentPlan): number {
  const sum = (plan.deposit?.amount ?? 0) + plan.payments.reduce((s, p) => s + p.amount, 0);
  return Math.round((total - sum) * 100) / 100;
}

const ORDINAL = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"];
const money = (n: number, currency: string | null) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${!currency || currency === "SAR" ? "ريال" : currency}`;

/** The plan as the client reads it, under «شروط الدفع». */
export function planLines(plan: PaymentPlan | undefined, currency: string | null): string[] {
  if (!plan) return [];
  const out: string[] = [];
  if (plan.deposit) {
    const note = plan.deposit.note.trim();
    out.push(`الدفعة الأولى لتثبيت الحجز: ${money(plan.deposit.amount, currency)} (${plan.deposit.refundable ? "مسترجعة" : "غير مسترجعة"})${note ? ` — ${note}` : ""}`);
  }
  plan.payments.forEach((p, i) => {
    const k = i + (plan.deposit ? 1 : 0);
    out.push(`الدفعة ${ORDINAL[k] ?? k + 1}: ${money(p.amount, currency)} — ${p.date ? `حتى ${p.date}` : "قبل السفر"}`);
  });
  return out;
}

/** «سياسة الاسترجاع»: each hotel's cancellation as its card prints it, once each. */
export function refundLines(hotels: { hotel_name: string | null; cancellation_policy?: string | null }[]): string[] {
  const out: string[] = [];
  for (const h of hotels) {
    const policy = h.cancellation_policy?.trim();
    if (!policy) continue;
    const line = h.hotel_name?.trim() ? `${h.hotel_name.trim()}: ${policy}` : policy;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}
