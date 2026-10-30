/**
 * «الفواتير» — the internal invoice of a confirmed case (the owner, 2026-10-30: «الفاتورة داخلية»; not a
 * ZATCA tax invoice). One per case, numbered from its file: what it costs, what came in, what is left,
 * the payment terms as agreed («الاتفاق المالي», else the house terms) and how it is paid.
 * Pure and clock-injected; amounts are what the client owes (caseTotal) — never a fee or a % on its own line.
 */

import { BALANCE_DAYS_BEFORE_TRAVEL, defaultSchedule, installmentStates, remainingBalance, METHOD_AR, type InstallmentState } from "@/lib/operations/payments";

export type InvoiceStatus = "paid" | "partial" | "overdue" | "due";
export const INVOICE_STATUS_AR: Record<InvoiceStatus, string> = { paid: "مسددة", partial: "مسددة جزئياً", overdue: "متأخرة", due: "مستحقة" };

export type InvoiceCase = {
  serial: string;
  confirmed_on: string;
  travel_start: string | null;
  total: number | null;
  paid: number;
  installments: { due_date: string | null; amount: number; note?: string | null }[];
  payments: { amount: number; kind: string; method: string | null }[];
};

export type InvoiceView = {
  number: string;
  status: InvoiceStatus;
  total: number | null;
  paid: number;
  /** what the client still owes; 0 when settled */
  due: number;
  terms: string;
  methods: string[];
  schedule: { due_date: string | null; amount: number; covered: number; state: InstallmentState }[];
};

export const invoiceNumber = (serial: string) => `INV-${serial}`;

export function invoiceOf(c: InvoiceCase, today: string): InvoiceView {
  const agreed = c.installments.length > 0;
  const schedule = agreed
    ? c.installments.map((r) => ({ due_date: r.due_date, amount: r.amount }))
    : defaultSchedule({ total: c.total, confirmed_on: c.confirmed_on, travel_start: c.travel_start });
  const rows = installmentStates(schedule, c.paid, today);
  const left = remainingBalance(c.total, c.paid);
  const due = left != null && left > 0 ? left : 0;
  const status: InvoiceStatus =
    c.total != null && due === 0 ? "paid" : rows.some((r) => r.state === "overdue") ? "overdue" : c.paid > 0 ? "partial" : "due";

  const dates = rows.map((r) => r.due_date).filter((d): d is string => !!d).sort();
  const terms = !agreed
    ? `نصف المبلغ عند التأكيد، والباقي ${c.travel_start ? `قبل السفر بـ${BALANCE_DAYS_BEFORE_TRAVEL} يوماً` : "قبل السفر"}`
    : rows.length === 1
      ? `دفعة واحدة${dates[0] ? ` بتاريخ ${dates[0]}` : ""}`
      : `على ${rows.length === 2 ? "دفعتين" : `${rows.length} ${rows.length <= 10 ? "دفعات" : "دفعة"}`}${dates.length ? ` حتى ${dates[dates.length - 1]}` : ""}`;

  // how it is paid: the agreement names a way per installment («الوسيلة: …»), else the payments say how they came
  const named = c.installments.map((r) => r.note?.match(/الوسيلة:\s*(.+)$/)?.[1]?.trim()).filter((m): m is string => !!m);
  const used = c.payments
    .filter((p) => p.kind !== "refund" && p.method)
    .map((p) => METHOD_AR[p.method as keyof typeof METHOD_AR] ?? p.method)
    .filter((m): m is string => !!m);
  const methods = [...new Set(named.length ? named : used)];

  return { number: invoiceNumber(c.serial), status, total: c.total, paid: c.paid, due, terms, methods, schedule: rows };
}
