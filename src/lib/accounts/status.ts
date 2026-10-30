/**
 * «حالة الشركة» — the accounts home's head (stage 9, the owner, 2026-10-30: «يعرض البطاقات و حالة الشركة
 * والديون والوضع و الخطط و الاستراتيجيات»). The system's figures (sales, profit at issue, what came in,
 * what clients and suppliers are owed, the expenses) beside the owner's book (treasury, debts, the fixed
 * costs that make the break-even, the partners' split, the monthly plans) — each read where it lives,
 * nothing copied. Pure; riyals.
 */

import type { FinanceBook } from "@/lib/finance/model";
import { breakEven, debtLeft, fixedCostIn, treasury } from "@/lib/finance/model";

export type SystemMonth = { sales: number; profit: number; expenses: number };

export type CompanyStatus = {
  month: string;
  quarter: { label: string; months: string[] };
  treasury: number;
  debts: { left: number; monthly: number; top: { creditor: string; left: number; monthly: number }[] };
  /** this month: the sales profit less the logged expenses less the book's fixed costs (salaries, rents due, instalments) */
  net: { month: number; quarter: number; fixedMonth: number };
  /** the bookings' profit a month must make to cover the fixed costs after the treasury's share */
  breakEven: { need: number; made: number; share: number };
  /** the quarter's distributable profit and each partner's part (only when it is positive) */
  split: { distributable: number; shares: { name: string; share: number; amount: number }[] };
  /** the book's monthly plans against what the system recorded */
  plans: {
    month: string;
    sales: { target: number; actual: number; share: number | null };
    profit: { target: number; actual: number; share: number | null };
    debtBudget: number;
    focus: string[];
    payments: string[];
  }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export function quarterOf(month: string): { label: string; months: string[] } {
  const [y, m] = month.split("-").map(Number);
  const q = Math.floor((m - 1) / 3);
  const months = [1, 2, 3].map((i) => `${y}-${String(q * 3 + i).padStart(2, "0")}`);
  return { label: `الربع ${q + 1} — ${y}`, months };
}

export function companyStatus(input: { month: string; book: FinanceBook; system: (month: string) => SystemMonth }): CompanyStatus {
  const { month, book, system } = input;
  const [y, m] = month.split("-").map(Number);
  const fixed = (mm: string) => {
    const [yy, mo] = mm.split("-").map(Number);
    return fixedCostIn(book, yy, mo);
  };
  const quarter = quarterOf(month);
  const now = system(month);
  const netOf = (mm: string) => {
    const s = system(mm);
    return s.profit - s.expenses - fixed(mm);
  };
  // the quarter's months so far: a month to come has no sales yet, but its fixed costs would weigh on the split
  const sofar = quarter.months.filter((mm) => mm <= month);
  const quarterProfit = sofar.reduce((s, mm) => s + system(mm).profit, 0);
  const reserve = (Math.max(0, quarterProfit) * book.reservePct) / 100;
  const distributable = r2(quarterProfit - reserve - sofar.reduce((s, mm) => s + system(mm).expenses + fixed(mm), 0));

  const open = book.debts.filter((d) => debtLeft(d) > 0);
  const need = breakEven(book, y, m);
  return {
    month,
    quarter,
    treasury: r2(treasury(book)),
    debts: {
      left: r2(open.reduce((s, d) => s + debtLeft(d), 0)),
      monthly: r2(open.reduce((s, d) => s + d.monthly, 0)),
      top: open.map((d) => ({ creditor: d.creditor, left: r2(debtLeft(d)), monthly: d.monthly })).sort((a, b) => b.left - a.left).slice(0, 6),
    },
    net: { month: r2(netOf(month)), quarter: r2(sofar.reduce((s, mm) => s + netOf(mm), 0)), fixedMonth: r2(fixed(month)) },
    breakEven: { need: r2(need), made: r2(now.profit), share: pct(now.profit, need) ?? 0 },
    split: {
      distributable,
      shares: book.partners.map((p) => ({ name: p.name, share: p.share, amount: distributable > 0 ? r2((distributable * p.share) / 100) : 0 })),
    },
    plans: [...book.targets]
      .filter((t) => t.month >= month)
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(0, 3)
      .map((t) => {
        const s = system(t.month);
        return {
          month: t.month,
          sales: { target: t.sales, actual: r2(s.sales), share: pct(s.sales, t.sales) },
          profit: { target: t.profit, actual: r2(s.profit), share: pct(s.profit, t.profit) },
          debtBudget: t.debtBudget,
          focus: lines(t.focus),
          payments: lines(t.payments),
        };
      }),
  };
}
