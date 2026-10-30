/**
 * «المستحقات» (stage 10, the owner, 2026-10-30: «لاحظت الفنادق بدون تواريخ الدفعات و لا الوقت المستحق …
 * اريد القسم ان يكون مترابط من كل النواحي»). When money is due — to a supplier (a booking's pay-by or
 * free-cancellation day, operation_bookings.cancellation_deadline + detail.refund_mode) and from a client
 * (the agreed installments, else the house terms) — and how many days are left. Pure and clock-injected.
 */

import { defaultSchedule, installmentStates, type InstallmentState } from "@/lib/operations/payments";

export type PayTerm = {
  /** pay_by: pay by that day or the booking is cancelled; refundable_until: free to cancel until then; deadline: a cancellation deadline with no mode set */
  kind: "pay_by" | "refundable_until" | "deadline";
  /** the Riyadh day */
  date: string;
  /** days from today; negative once it has passed */
  days: number;
};

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** a booking's money deadline; `deadlineDay` is cancellation_deadline as a Riyadh day */
export function payTerm(b: { refund_mode: string | null; deadlineDay: string | null }, today: string): PayTerm | null {
  if (!b.deadlineDay || !/^\d{4}-\d{2}-\d{2}$/.test(b.deadlineDay)) return null;
  const kind = b.refund_mode === "pay_by" || b.refund_mode === "refundable_until" ? b.refund_mode : "deadline";
  return { kind, date: b.deadlineDay, days: dayDiff(today, b.deadlineDay) };
}

const inDays = (n: number) => (n === 1 ? "يوم" : n === 2 ? "يومين" : `${n} ${n <= 10 ? "أيام" : "يوماً"}`);

/** «ادفع قبل … · باقي …» — the words every accounts table shows for a deadline */
export function payTermText(t: PayTerm): string {
  // a date inside Arabic is isolated left-to-right (LRI … PDI), or the bidi algorithm turns 2026-10-28 into 28-10-2026
  const date = `\u2066${t.date}\u2069`;
  const left = t.days === 0 ? "اليوم" : t.days > 0 ? `باقي ${inDays(t.days)}` : `فات منذ ${inDays(-t.days)}`;
  if (t.kind === "pay_by") return t.days === 0 ? "ادفع اليوم وإلا يُلغى الحجز" : `ادفع قبل ${date} · ${left}`;
  if (t.kind === "refundable_until") return t.days < 0 ? `انتهى الإلغاء المجاني ${date}` : `إلغاء مجاني حتى ${date} · ${left}`;
  return `آخر موعد ${date} · ${left}`;
}

/** red: passed or today on a pay-by; amber: within three days; else calm */
export const payTermTone = (t: PayTerm): "danger" | "warning" | "calm" =>
  t.days < 0 || (t.kind === "pay_by" && t.days === 0) ? "danger" : t.days <= 3 ? "warning" : "calm";

// ------------------------------------------------------- client installments ----

export type InstallmentCase = {
  id: string; serial: string; client: string; confirmed_on: string; travel_start: string | null;
  total: number | null; paid: number; installments: { due_date: string | null; amount: number }[];
};
export type InstallmentDue = { id: string; serial: string; client: string; due_date: string | null; left: number; state: InstallmentState; days: number | null; agreed: boolean };

/** every installment not settled yet, across the live files, the earliest first (no date last) */
export function installmentsDue(cases: InstallmentCase[], today: string): InstallmentDue[] {
  const out: InstallmentDue[] = [];
  for (const c of cases) {
    const agreed = c.installments.length > 0;
    const schedule = agreed ? c.installments : defaultSchedule({ total: c.total, confirmed_on: c.confirmed_on, travel_start: c.travel_start });
    for (const r of installmentStates(schedule, c.paid, today)) {
      if (r.state === "paid") continue;
      out.push({ id: c.id, serial: c.serial, client: c.client, due_date: r.due_date, left: Math.round((r.amount - r.covered) * 100) / 100, state: r.state, days: r.due_date ? dayDiff(today, r.due_date) : null, agreed });
    }
  }
  return out.sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
}
