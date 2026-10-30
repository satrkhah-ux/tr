/**
 * «الحسابات» — the financial section's home (the owner, 2026-10-30: a screen at the level of «قائمة»):
 * the month's net sales and net profit, its sales week by week, what came in, what clients still owe,
 * the overdue «invoices» and the month's top suppliers.
 *
 * Read from what is already there — the confirmed cases (operation-money.ts loadCases), their
 * payments and the agreed schedule (payments.ts) — never a second ledger. Riyals only: a figure in
 * another currency is counted apart (`other`), never added to riyals. Pure and clock-injected.
 */

import { caseProfit, type CaseFacts } from "@/lib/operations/money";
import { defaultSchedule, installmentStates, remainingBalance, type Installment } from "@/lib/operations/payments";

export const HOME_CURRENCY = "SAR";
const round2 = (n: number) => Math.round(n * 100) / 100;

export type HomeCase = {
  id: string;
  serial: string;
  /** the Riyadh month it was confirmed in, YYYY-MM */
  month: string;
  confirmed_on: string;
  travel_start: string | null;
  cancelled: boolean;
  currency: string;
  total: number | null;
  facts: CaseFacts;
  installments: Installment[];
  paid: number;
};
export type HomePayment = { operation_id: string; amount: number; currency: string; kind: string; paid_on: string | null };
export type HomeSupplierLine = { operation_id: string; supplier: string; cost: number; currency: string; status: string };

export type OverdueInvoice = { id: string; serial: string; amount: number; since: string; days: number };
export type AccountsHome = {
  month: string;
  today: string;
  sales: number;
  /** cases confirmed in the month */
  count: number;
  /** expected: each sale against its buy at issue — the profitability report's measure */
  profit: number;
  margin: number | null;
  /** client money in during the month, refunds subtracted */
  collected: number;
  /** what clients still owe on every live case today */
  receivable: number;
  overdue: { amount: number; invoices: OverdueInvoice[] };
  /** the month in five spans: days 1–7, 8–14, 15–21, 22–28, 29–end */
  weeks: { label: string; amount: number }[];
  suppliers: { name: string; amount: number; bookings: number }[];
  /** cases of the month sold in another currency — counted, never summed into riyals */
  other: number;
};

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function accountsHome(input: { month: string; today: string; cases: HomeCase[]; payments: HomePayment[]; suppliers: HomeSupplierLine[] }): AccountsHome {
  const { month, today } = input;
  const live = input.cases.filter((c) => !c.cancelled);
  const ofMonth = live.filter((c) => c.month === month);
  const sar = ofMonth.filter((c) => (c.facts.sale?.currency ?? c.currency) === HOME_CURRENCY);

  let sales = 0;
  let profit = 0;
  const weeks = [0, 0, 0, 0, 0];
  for (const c of sar) {
    const sale = c.facts.sale?.amount ?? 0;
    sales += sale;
    weeks[Math.min(4, Math.floor((Number(c.confirmed_on.slice(8, 10)) - 1) / 7))] += sale;
    profit += caseProfit(c.facts).expected.find((l) => l.currency === HOME_CURRENCY)?.profit ?? 0;
  }

  const collected = input.payments
    .filter((p) => p.currency === HOME_CURRENCY && p.paid_on?.startsWith(month))
    .reduce((s, p) => s + (p.kind === "refund" ? -p.amount : p.amount), 0);

  // what is owed and late is today's picture, whatever month is shown; a partner's file is billed to the partner, not here
  let receivable = 0;
  const invoices: OverdueInvoice[] = [];
  for (const c of live) {
    if (c.facts.partner || c.currency !== HOME_CURRENCY) continue;
    const left = remainingBalance(c.total, c.paid);
    if (left != null && left > 0) receivable += left;
    const schedule = c.installments.length ? c.installments : defaultSchedule({ total: c.total, confirmed_on: c.confirmed_on, travel_start: c.travel_start });
    const late = installmentStates(schedule, c.paid, today).filter((r) => r.state === "overdue" && r.due_date);
    if (!late.length) continue;
    const since = late.map((r) => r.due_date as string).sort()[0];
    invoices.push({ id: c.id, serial: c.serial, amount: round2(late.reduce((s, r) => s + r.amount - r.covered, 0)), since, days: daysBetween(since, today) });
  }
  invoices.sort((a, b) => b.days - a.days || b.amount - a.amount);

  const monthIds = new Set(ofMonth.map((c) => c.id));
  const bySupplier = new Map<string, { amount: number; bookings: number }>();
  for (const l of input.suppliers) {
    if (!monthIds.has(l.operation_id) || l.status === "cancelled" || l.currency !== HOME_CURRENCY || !(l.cost > 0)) continue;
    const name = l.supplier.trim() || "بلا مورد";
    const s = bySupplier.get(name) ?? { amount: 0, bookings: 0 };
    bySupplier.set(name, { amount: s.amount + l.cost, bookings: s.bookings + 1 });
  }

  return {
    month,
    today,
    sales: round2(sales),
    count: sar.length,
    profit: round2(profit),
    margin: sales > 0 ? Math.round((profit / sales) * 1000) / 10 : null,
    collected: round2(collected),
    receivable: round2(receivable),
    overdue: { amount: round2(invoices.reduce((s, i) => s + i.amount, 0)), invoices },
    weeks: weeks.map((amount, i) => ({ label: `الأسبوع ${i + 1}`, amount: round2(amount) })),
    suppliers: [...bySupplier].map(([name, s]) => ({ name, amount: round2(s.amount), bookings: s.bookings })).sort((a, b) => b.amount - a.amount).slice(0, 5),
    other: ofMonth.length - sar.length,
  };
}

/** The last `n` months up to `month`, newest first — the month picker. */
export function recentMonths(month: string, n = 6): string[] {
  const [y, m] = month.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
}
