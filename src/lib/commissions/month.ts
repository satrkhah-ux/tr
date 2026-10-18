/**
 * Which files earn commission in a month, and on what (the owner, 2026-10-18):
 * a file counts in the month its client finished paying — the day of the last
 * payment that left it «مدفوع بالكامل» — on its ACTUAL profit: the money that
 * came in against what the suppliers were paid and still cost us
 * (lib/operations/money.ts caseProfit). Everything is turned into riyals here,
 * because the commission engine splits one pool in halalas.
 *
 * Pure: the rates and the cases are parameters, so it is tested without a database.
 */

import { convert, type CurrencyRates } from "@/lib/offer/pricing";
import { caseProfit, type CaseFacts } from "@/lib/operations/money";

export type CommissionCase = {
  id: string;
  serial: string;
  destination: string | null;
  employee_id: string | null;
  client_status: string;
  cancelled: boolean;
  /** Riyadh day of the client's last payment (refunds aside). */
  last_paid_on: string | null;
  facts: CaseFacts;
};

export type CommissionFile = {
  operation_id: string;
  serial: string;
  destination: string | null;
  paid_on: string;
  revenue: number;
  cost: number;
  profit: number;
  /** no supplier cost recorded at all: the «profit» is the whole sale until operations records what was paid. */
  no_cost: boolean;
};

export type EmployeeMonth = {
  employee_id: string;
  sales: number;
  profit: number;
  files: CommissionFile[];
};

/** A file the month could not price: a currency with no rate. Shown, never guessed. */
export type SkippedFile = { operation_id: string; serial: string; employee_id: string; currency: string };

const PAID = new Set(["paid_full", "completed"]);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function commissionMonth(cases: CommissionCase[], month: string, rates: CurrencyRates): { employees: EmployeeMonth[]; skipped: SkippedFile[] } {
  const by = new Map<string, EmployeeMonth>();
  const skipped: SkippedFile[] = [];
  for (const c of cases) {
    if (c.cancelled || !c.employee_id || !PAID.has(c.client_status) || !c.last_paid_on?.startsWith(month)) continue;
    let revenue = 0;
    let cost = 0;
    let missing: string | null = null;
    for (const l of caseProfit(c.facts).actual) {
      const r = convert(l.revenue, l.currency, rates, "SAR");
      const k = convert(l.cost, l.currency, rates, "SAR");
      if (r === null || k === null) {
        missing = l.currency;
        break;
      }
      revenue += r;
      cost += k;
    }
    if (missing) {
      skipped.push({ operation_id: c.id, serial: c.serial, employee_id: c.employee_id, currency: missing });
      continue;
    }
    const file: CommissionFile = {
      operation_id: c.id,
      serial: c.serial,
      destination: c.destination,
      paid_on: c.last_paid_on,
      revenue: round2(revenue),
      cost: round2(cost),
      profit: round2(revenue - cost),
      no_cost: cost === 0,
    };
    let e = by.get(c.employee_id);
    if (!e) by.set(c.employee_id, (e = { employee_id: c.employee_id, sales: 0, profit: 0, files: [] }));
    e.files.push(file);
    e.sales = round2(e.sales + file.revenue);
    e.profit = round2(e.profit + file.profit);
  }
  for (const e of by.values()) e.files.sort((a, b) => a.paid_on.localeCompare(b.paid_on));
  return { employees: [...by.values()], skipped };
}
