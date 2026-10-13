/**
 * The company's money on a case, in arithmetic only (operations order 11, items
 * 7 and 8): what a case was expected to earn when it was sold, what it is
 * earning in fact, and when money is due in and out week by week.
 *
 * Every figure is per currency and never summed across currencies — a margin
 * in riyals and one in dollars are two margins, not one. Pure and
 * clock-injected (`today` is a parameter), so it is tested without a database.
 * Internal: everything here is cost, read only behind pricing.internal.
 */

import { installmentStates, type Installment } from "./payments";
import type { Money } from "./supplier-request";

export type { Money };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A movement of money; a refund is stored positive and subtracted here. */
export type Flow = Money & { kind?: string };
const signed = (f: Flow) => (f.kind === "refund" ? -f.amount : f.amount);

/** Sum per currency, never across. */
export function byCurrency(list: Flow[]): Money[] {
  const by = new Map<string, number>();
  for (const f of list) by.set(f.currency, round2((by.get(f.currency) ?? 0) + signed(f)));
  return [...by.entries()].map(([currency, amount]) => ({ currency, amount }));
}

export type MoneyLine = { currency: string; revenue: number; cost: number; profit: number; margin: number | null };

/** Margin % of revenue; none when there is no revenue to measure it against. */
const marginOf = (revenue: number, profit: number) => (revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null);

/** Revenue against cost, one line per currency either side mentions. */
export function moneyLines(revenue: Flow[], cost: Flow[]): MoneyLine[] {
  const by = new Map<string, MoneyLine>();
  const line = (currency: string) => {
    let l = by.get(currency);
    if (!l) by.set(currency, (l = { currency, revenue: 0, cost: 0, profit: 0, margin: null }));
    return l;
  };
  for (const r of byCurrency(revenue)) line(r.currency).revenue = r.amount;
  for (const c of byCurrency(cost)) line(c.currency).cost = c.amount;
  return [...by.values()].map((l) => {
    const profit = round2(l.revenue - l.cost);
    return { ...l, profit, margin: marginOf(l.revenue, profit) };
  });
}

export type PricingLine = {
  quantity: number | null;
  buy_price: number | null;
  buy_currency: string | null;
  total_buy: number | null;
};

/** One pricing line's buy, the way supplier-work and the executive tab read it. */
export function lineBuy(l: PricingLine, fallbackCurrency: string): Money | null {
  const amount = l.total_buy ?? (l.buy_price != null ? Number(l.buy_price) * (l.quantity && l.quantity > 0 ? l.quantity : 1) : null);
  return amount != null && Number.isFinite(Number(amount)) ? { amount: Number(amount), currency: l.buy_currency || fallbackCurrency } : null;
}

/**
 * What the offer was expected to cost when it was sold: the classic `pricings`
 * buy_total when there is one, else the generator's pricing lines, each in its
 * own buy currency — the executive tab's order.
 */
export function expectedCost(pricingsBuy: Money | null, lines: PricingLine[], offerCurrency: string): Money[] {
  if (pricingsBuy != null) return [pricingsBuy];
  return byCurrency(lines.map((l) => lineBuy(l, offerCurrency)).filter((m): m is Money => m !== null));
}

export type CaseBooking = {
  status: string;
  is_paid: boolean;
  start_date: string | null;
  /** Riyadh day of the cancellation deadline. */
  deadline: string | null;
  /** null = no cost known (bookingCost found none). */
  cost: Money | null;
};

/** A supplier cost we still owe: a confirmed booking that is not paid yet. */
export const stillOwed = (b: CaseBooking) => b.status === "confirmed" && !b.is_paid && b.cost !== null && b.cost.amount > 0;

export type CaseFacts = {
  /** expected revenue at sale: the offer's total — or, on a partner's file, its invoice to us. */
  sale: Money | null;
  expectedCost: Money[];
  /** a partner's file earns us its invoice, not what its client paid the partner. */
  partner: boolean;
  invoice: Money | null;
  /** our own file: what the client paid (refunds subtract). */
  clientPayments: Flow[];
  /** what we paid suppliers on this case (refunds subtract). */
  supplierPayments: Flow[];
  bookings: CaseBooking[];
};

export type CaseProfit = {
  expected: MoneyLine[];
  actual: MoneyLine[];
  received: Money[];
  supplierPaid: Money[];
  supplierOwed: Money[];
};

/**
 * Expected: the sale against the buy at issue. Actual: the money that came in
 * (client payments, or the partner's invoice) against what we paid suppliers
 * plus what confirmed, unpaid bookings still cost us.
 */
export function caseProfit(f: CaseFacts): CaseProfit {
  const received = f.partner ? (f.invoice ? [f.invoice] : []) : byCurrency(f.clientPayments);
  const supplierPaid = byCurrency(f.supplierPayments);
  const supplierOwed = byCurrency(f.bookings.filter(stillOwed).map((b) => b.cost as Money));
  return {
    expected: moneyLines(f.sale ? [f.sale] : [], f.expectedCost),
    actual: moneyLines(received, [...supplierPaid, ...supplierOwed]),
    received,
    supplierPaid,
    supplierOwed,
  };
}

// ------------------------------------------------------------- the report ----

export type ProfitRow = { cases: number; currency: string; expected: MoneyLine; actual: MoneyLine };

/**
 * Cases grouped by a key (month, employee, destination), one row per group and
 * currency. `cases` counts the cases in the group, whatever their currency.
 */
export function groupProfit<T extends { profit: CaseProfit }>(cases: T[], keyOf: (c: T) => string): (ProfitRow & { key: string })[] {
  const groups = new Map<string, T[]>();
  for (const c of cases) {
    const k = keyOf(c);
    const list = groups.get(k);
    if (list) list.push(c);
    else groups.set(k, [c]);
  }
  const out: (ProfitRow & { key: string })[] = [];
  for (const [key, list] of groups) {
    const flows = (pick: (p: CaseProfit) => MoneyLine[], side: "revenue" | "cost") =>
      list.flatMap((c) => pick(c.profit).map((l) => ({ amount: l[side], currency: l.currency })));
    const expected = moneyLines(flows((p) => p.expected, "revenue"), flows((p) => p.expected, "cost"));
    const actual = moneyLines(flows((p) => p.actual, "revenue"), flows((p) => p.actual, "cost"));
    const empty = (currency: string): MoneyLine => ({ currency, revenue: 0, cost: 0, profit: 0, margin: null });
    for (const currency of [...new Set([...expected, ...actual].map((l) => l.currency))].sort()) {
      out.push({
        key,
        cases: list.length,
        currency,
        expected: expected.find((l) => l.currency === currency) ?? empty(currency),
        actual: actual.find((l) => l.currency === currency) ?? empty(currency),
      });
    }
  }
  return out;
}

// ------------------------------------------------------------ cash flow ----

export type CashItem = {
  direction: "in" | "out";
  /** the day it is due; null = no date yet. */
  date: string | null;
  amount: number;
  currency: string;
  kind: "installment" | "partner_invoice" | "supplier";
  operation_id: string | null;
  serial: string;
  title: string;
};

/** What the client still owes, installment by installment (earliest debt settled first). */
export function clientDue(schedule: Installment[], paid: number, today: string): { date: string | null; amount: number }[] {
  return installmentStates(schedule, paid, today)
    .map((r) => ({ date: r.due_date, amount: round2(r.amount - r.covered) }))
    .filter((r) => r.amount > 0);
}

/**
 * A partner pays its account, not an invoice: its payments settle its oldest
 * invoices first, per currency. Returns each invoice with what is still open.
 */
export function openInvoices<T extends Money & { partner_id: string; issued_at: string }>(
  invoices: T[],
  payments: (Money & { partner_id: string })[],
): (T & { open: number })[] {
  const left = new Map<string, number>();
  const key = (x: { partner_id: string; currency: string }) => `${x.partner_id}|${x.currency}`;
  for (const p of payments) left.set(key(p), round2((left.get(key(p)) ?? 0) + p.amount));
  return [...invoices]
    .sort((a, b) => a.issued_at.localeCompare(b.issued_at))
    .map((inv) => {
      const credit = Math.max(left.get(key(inv)) ?? 0, 0);
      const covered = Math.min(credit, inv.amount);
      left.set(key(inv), round2(credit - covered));
      return { ...inv, open: round2(inv.amount - covered) };
    });
}

/** A supplier is paid by the cancellation deadline, else by the day the service starts — whichever comes first. */
export function supplierDueDate(b: Pick<CaseBooking, "start_date" | "deadline">): string | null {
  const days = [b.deadline, b.start_date].filter((d): d is string => !!d).sort();
  return days[0] ?? null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type CashLine = { currency: string; in: number; out: number; net: number };
export type CashBucket = {
  key: "overdue" | "week" | "later";
  /** the week's first and last day; null on «overdue» and «later». */
  from: string | null;
  to: string | null;
  lines: CashLine[];
  items: CashItem[];
};

/**
 * Overdue, then `weeks` rolling weeks starting today, then everything later or
 * undated — so nothing owed silently drops out of the view.
 */
export function cashflowBuckets(items: CashItem[], today: string, weeks = 8): CashBucket[] {
  const buckets: CashBucket[] = [
    { key: "overdue", from: null, to: null, lines: [], items: [] },
    ...Array.from({ length: weeks }, (_, i) => ({
      key: "week" as const,
      from: addDays(today, i * 7),
      to: addDays(today, i * 7 + 6),
      lines: [],
      items: [],
    })),
    { key: "later", from: null, to: null, lines: [], items: [] },
  ];
  const end = addDays(today, weeks * 7);
  for (const item of items) {
    if (!(item.amount > 0)) continue;
    const at =
      item.date == null || item.date >= end
        ? buckets.length - 1
        : item.date < today
          ? 0
          : 1 + Math.floor((Date.parse(`${item.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (7 * 86_400_000));
    buckets[at].items.push(item);
  }
  for (const b of buckets) {
    b.items.sort((x, y) => (x.date ?? "9999").localeCompare(y.date ?? "9999"));
    const by = new Map<string, CashLine>();
    for (const i of b.items) {
      const l = by.get(i.currency) ?? { currency: i.currency, in: 0, out: 0, net: 0 };
      l[i.direction] = round2(l[i.direction] + i.amount);
      l.net = round2(l.in - l.out);
      by.set(i.currency, l);
    }
    b.lines = [...by.values()].sort((x, y) => x.currency.localeCompare(y.currency));
  }
  return buckets;
}
