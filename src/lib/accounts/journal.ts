/**
 * «القيود اليومية» (stage 4, 2026-10-30) — the month's journal, written from what the system already
 * records, never typed twice: a confirmed sale, a client's payment or refund, a payment to a supplier or
 * its refund, a company expense. Every entry balances (debit = credit). Riyals only; a partner's file
 * (billed to the partner) and a cancelled case are left out — ponytail: a cancellation's reversing
 * entries come when the accountant asks for them. Pure: tested without a database.
 */

import type { ExpenseCategory } from "./expenses";
import { EXPENSE_CATEGORY_AR } from "./expenses";

export const ACCOUNTS = {
  cash: { code: "1100", name: "النقدية والبنك" },
  receivable: { code: "1200", name: "ذمم العملاء" },
  payable: { code: "2100", name: "ذمم الموردين" },
  revenue: { code: "4100", name: "إيرادات الرحلات" },
  cost: { code: "5100", name: "تكلفة الرحلات" },
  expense: { code: "5200", name: "مصروفات تشغيلية" },
} as const;
export type AccountKey = keyof typeof ACCOUNTS;

export type JournalLine = { account: AccountKey; debit: number; credit: number; detail?: string };
export type JournalEntry = { date: string; ref: string; memo: string; lines: JournalLine[] };

export type JournalInput = {
  month: string;
  /** our own live cases: confirmed day, the client's price and the buy at issue (riyals) */
  sales: { serial: string; client: string; on: string; price: number; cost: number }[];
  clientPayments: { serial: string; client: string; on: string; amount: number; kind: string; receipt: string | null }[];
  supplierPayments: { supplier: string; serial: string; on: string; amount: number; kind: "payment" | "refund"; reference: string | null }[];
  expenses: { on: string; title: string; category: ExpenseCategory; amount: number }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const pair = (debit: AccountKey, credit: AccountKey, amount: number, detail?: string): JournalLine[] => [
  { account: debit, debit: r2(amount), credit: 0, detail },
  { account: credit, debit: 0, credit: r2(amount) },
];

export function journal(input: JournalInput): { entries: JournalEntry[]; totals: { account: AccountKey; debit: number; credit: number }[]; balanced: boolean } {
  const inMonth = (d: string) => d.startsWith(input.month);
  const entries: JournalEntry[] = [];

  for (const s of input.sales.filter((x) => inMonth(x.on) && x.price > 0)) {
    entries.push({
      date: s.on,
      ref: s.serial,
      memo: `بيع رحلة — ${s.client || s.serial}`,
      lines: [...pair("receivable", "revenue", s.price), ...(s.cost > 0 ? pair("cost", "payable", s.cost) : [])],
    });
  }
  for (const p of input.clientPayments.filter((x) => inMonth(x.on) && x.amount > 0)) {
    const refund = p.kind === "refund";
    entries.push({
      date: p.on,
      ref: p.receipt ?? p.serial,
      memo: `${refund ? "استرجاع لعميل" : "دفعة من عميل"} — ${p.client || p.serial}`,
      lines: refund ? pair("receivable", "cash", p.amount) : pair("cash", "receivable", p.amount),
    });
  }
  for (const p of input.supplierPayments.filter((x) => inMonth(x.on) && x.amount > 0)) {
    const refund = p.kind === "refund";
    entries.push({
      date: p.on,
      ref: p.reference ?? p.serial,
      memo: `${refund ? "استرداد من مورد" : "سداد لمورد"} — ${p.supplier}`,
      lines: refund ? pair("cash", "payable", p.amount) : pair("payable", "cash", p.amount),
    });
  }
  for (const e of input.expenses.filter((x) => inMonth(x.on) && x.amount > 0)) {
    entries.push({ date: e.on, ref: "", memo: `مصروف — ${e.title}`, lines: pair("expense", "cash", e.amount, EXPENSE_CATEGORY_AR[e.category]) });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));

  const by = new Map<AccountKey, { debit: number; credit: number }>();
  for (const l of entries.flatMap((e) => e.lines)) {
    const t = by.get(l.account) ?? { debit: 0, credit: 0 };
    by.set(l.account, { debit: r2(t.debit + l.debit), credit: r2(t.credit + l.credit) });
  }
  const totals = (Object.keys(ACCOUNTS) as AccountKey[]).filter((k) => by.has(k)).map((k) => ({ account: k, ...by.get(k)! }));
  const debit = r2(totals.reduce((s, t) => s + t.debit, 0));
  const credit = r2(totals.reduce((s, t) => s + t.credit, 0));
  return { entries, totals, balanced: debit === credit };
}

/** The journal as a CSV the accountant opens in Excel (UTF-8 with its mark, so Arabic reads right). */
export function journalCsv(entries: JournalEntry[]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [["التاريخ", "المرجع", "البيان", "رقم الحساب", "الحساب", "مدين", "دائن", "تفصيل"]];
  for (const e of entries) for (const l of e.lines) rows.push([e.date, e.ref, e.memo, ACCOUNTS[l.account].code, ACCOUNTS[l.account].name, l.debit ? String(l.debit) : "", l.credit ? String(l.credit) : "", l.detail ?? ""]);
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
