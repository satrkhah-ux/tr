/**
 * «التقارير المالية» (stage 5, the owner, 2026-10-30: «من بقي لم يسدد و من لم يسدد و من الفنادق التي
 * اكثر دفعا و من الموظفين اكثر تاكيدا و تنفيذ للعمليات المالية»). Read from what is recorded — cases,
 * their schedules and payments, bookings, supplier payments, sales targets — never a second copy.
 * Riyals only; a partner's file is billed to the partner and stays out. Pure and clock-injected.
 */

import { invoiceOf } from "./invoice";

const r2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------- period ----

export type Period = { key: string; label: string; months: string[] };

/** "YYYY-MM" = that month; "3m" / "12m" = the last three / twelve months up to this one */
export function periodOf(param: string | undefined, thisMonth: string): Period {
  const back = (n: number) => {
    const [y, m] = thisMonth.split("-").map(Number);
    return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  };
  if (param === "3m") return { key: "3m", label: "آخر 3 أشهر", months: back(3) };
  if (param === "12m") return { key: "12m", label: "آخر 12 شهراً", months: back(12) };
  const month = param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) && param <= thisMonth ? param : thisMonth;
  return { key: month, label: "", months: [month] };
}

// ------------------------------------------------------------ clients ----

export type ReportCase = {
  id: string;
  serial: string;
  client: string;
  seller: string;
  employee_id: string | null;
  month: string;
  confirmed_on: string;
  travel_start: string | null;
  total: number | null;
  paid: number;
  installments: { due_date: string | null; amount: number }[];
  /** sale against its buy at issue, riyals */
  profit: number;
};

export type ClientDebt = {
  id: string; serial: string; client: string; seller: string;
  total: number; paid: number; due: number;
  /** nothing paid at all (late or not) / part paid and a payment's day passed / part paid, nothing late */
  state: "unpaid" | "remaining" | "overdue";
  lateDays: number;
};

/** Every file with money still owed today: the unpaid first, then the late, then the rest — each by how long it is late. */
export function clientDebts(cases: ReportCase[], today: string): { rows: ClientDebt[]; totals: Record<ClientDebt["state"], { count: number; due: number }> } {
  const rows: ClientDebt[] = [];
  for (const c of cases) {
    const inv = invoiceOf({ ...c, payments: [] }, today);
    if (!(inv.due > 0) || c.total == null) continue;
    const late = inv.schedule.filter((r) => r.state === "overdue" && r.due_date).map((r) => r.due_date as string).sort()[0];
    const lateDays = late ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${late}T00:00:00Z`)) / 86_400_000) : 0;
    rows.push({ id: c.id, serial: c.serial, client: c.client, seller: c.seller, total: c.total, paid: c.paid, due: inv.due, state: !(c.paid > 0) ? "unpaid" : late ? "overdue" : "remaining", lateDays });
  }
  const rank = { unpaid: 0, overdue: 1, remaining: 2 };
  rows.sort((a, b) => rank[a.state] - rank[b.state] || b.lateDays - a.lateDays || b.due - a.due);
  const totals = { overdue: { count: 0, due: 0 }, unpaid: { count: 0, due: 0 }, remaining: { count: 0, due: 0 } };
  for (const r of rows) totals[r.state] = { count: totals[r.state].count + 1, due: r2(totals[r.state].due + r.due) };
  return { rows, totals };
}

// --------------------------------------------------- suppliers and hotels ----

export type ReportBooking = { kind: string; title: string; city: string | null; supplier: string; status: string; cost: number };
export type ReportSupplierPayment = { supplier: string; amount: number; kind: "payment" | "refund" };

export function supplierSpend(bookings: ReportBooking[], payments: ReportSupplierPayment[]) {
  const live = bookings.filter((b) => b.status !== "cancelled" && b.cost > 0);
  const group = (key: (b: ReportBooking) => string) => {
    const by = new Map<string, { booked: number; bookings: number }>();
    for (const b of live) {
      const k = key(b);
      const s = by.get(k) ?? { booked: 0, bookings: 0 };
      by.set(k, { booked: r2(s.booked + b.cost), bookings: s.bookings + 1 });
    }
    return by;
  };
  const paid = new Map<string, number>();
  for (const p of payments) paid.set(p.supplier, r2((paid.get(p.supplier) ?? 0) + (p.kind === "refund" ? -p.amount : p.amount)));
  const suppliers = [...group((b) => b.supplier.trim() || "بلا مورد")]
    .map(([name, s]) => ({ name, ...s, paid: paid.get(name) ?? 0 }))
    .sort((a, b) => b.booked - a.booked);
  const hotels = [...group((b) => (b.kind === "hotel" ? `${b.title.trim()}${b.city ? ` — ${b.city}` : ""}` : ""))]
    .filter(([name]) => name)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.booked - a.booked);
  return { suppliers, hotels };
}

// ------------------------------------------------------------ employees ----

export type EmployeeRow = {
  employee_id: string;
  name: string;
  confirmed: number;
  sales: number;
  profit: number;
  /** what came in on the files they confirmed */
  collected: number;
  target: number | null;
  /** sales ÷ target, %; null without a target */
  achieved: number | null;
  /** money operations they recorded in the period: client payments and supplier payments */
  recorded: number;
};

/**
 * Per seller: the files confirmed in the period, their sales, profit and what came in, against the
 * period's target (each month's own, else the standing one), and the money operations each recorded.
 */
export function employeeResults(input: {
  months: string[];
  cases: ReportCase[];
  names: Record<string, string>;
  /** month null = the standing monthly target */
  targets: { employee_id: string; month: string | null; amount: number }[];
  recordedBy: string[];
}): EmployeeRow[] {
  const by = new Map<string, EmployeeRow>();
  const row = (id: string) => {
    let r = by.get(id);
    if (!r) by.set(id, (r = { employee_id: id, name: input.names[id] ?? "", confirmed: 0, sales: 0, profit: 0, collected: 0, target: null, achieved: null, recorded: 0 }));
    return r;
  };
  for (const c of input.cases) {
    if (!c.employee_id || !input.months.includes(c.month)) continue;
    const r = row(c.employee_id);
    r.confirmed += 1;
    r.sales = r2(r.sales + (c.total ?? 0));
    r.profit = r2(r.profit + c.profit);
    r.collected = r2(r.collected + c.paid);
  }
  for (const id of input.recordedBy) row(id).recorded += 1;
  for (const r of by.values()) {
    const mine = input.targets.filter((t) => t.employee_id === r.employee_id);
    const standing = mine.find((t) => t.month === null)?.amount ?? null;
    const perMonth = input.months.map((m) => mine.find((t) => t.month === m)?.amount ?? standing);
    if (perMonth.some((t) => t != null)) {
      r.target = r2(perMonth.reduce<number>((s, t) => s + (t ?? 0), 0));
      r.achieved = r.target > 0 ? Math.round((r.sales / r.target) * 1000) / 10 : null;
    }
  }
  return [...by.values()].sort((a, b) => b.sales - a.sales || b.recorded - a.recorded);
}

// --------------------------------------------------------------- export ----

/** A report as a CSV for Excel (UTF-8 with its mark, so Arabic reads right). */
export function toCsv(head: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}
