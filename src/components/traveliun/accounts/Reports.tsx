"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, BarChart3, Download } from "lucide-react";
import type { ReportsView } from "@/lib/data/accounts";
import { toCsv, type ClientDebt } from "@/lib/accounts/reports";
import { card, monthName, Num, sar } from "./ui";

/** «التقارير المالية» (finance.accounts; the loader checks): who owes, whom we pay most, each employee's results. */

const back = "inline-flex h-9 items-center gap-2 rounded-[9px] border border-tv-border-default bg-tv-surface-raised px-3 text-[12.5px] font-bold text-tv-text-muted hover:bg-tv-surface-sunken";
const chip = (on: boolean) =>
  `min-h-10 rounded-full border px-3 text-[12.5px] font-bold ${on ? "border-tv-action-primary bg-tv-action-primary text-tv-action-on-primary" : "border-tv-border-default text-tv-text-brand hover:bg-tv-surface-sunken"}`;
const th = "whitespace-nowrap px-2 py-2 text-start text-[11.5px] font-bold text-tv-text-faint";
const td = "whitespace-nowrap px-2 py-2 text-[12.5px] font-bold text-tv-text-strong";
const STATE_AR: Record<ClientDebt["state"], string> = { unpaid: "لم يدفع شيئاً", overdue: "متأخر عن قسطه", remaining: "عليه باقٍ" };
const STATE_TONE: Record<ClientDebt["state"], string> = {
  overdue: "bg-tv-status-danger-bg text-tv-status-danger",
  unpaid: "bg-tv-status-warning-bg text-tv-status-warning",
  remaining: "bg-tv-surface-sunken text-tv-text-brand",
};

const days = (n: number) => (n === 1 ? "يوم" : n === 2 ? "يومين" : `${n} ${n <= 10 ? "أيام" : "يوماً"}`);

function save(name: string, csv: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
const Export = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-tv-border-default px-3 text-[12px] font-bold text-tv-text-brand hover:bg-tv-surface-sunken">
    <Download className="size-4" />Excel
  </button>
);

type Tab = "clients" | "suppliers" | "employees";

export function ReportsPage({ r }: { r: ReportsView }) {
  const [tab, setTab] = useState<Tab>("clients");
  const [state, setState] = useState<"all" | ClientDebt["state"]>("all");
  const periods: [string, string][] = [...r.months.slice(0, 3).map((m) => [m, monthName(m)] as [string, string]), ["3m", "آخر 3 أشهر"], ["12m", "آخر 12 شهراً"]];
  const debts = state === "all" ? r.debts.rows : r.debts.rows.filter((d) => d.state === state);
  const tag = r.period.label || monthName(r.period.key);

  return (
    <>
      <div dir="rtl" className="tv-fade-up mx-auto max-w-5xl space-y-4">
        <Link href="/accounts" className={back}><ArrowRight className="size-4" />الحسابات</Link>
        <section className={card}>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-tv-text-strong"><BarChart3 className="size-5" />التقارير المالية</h1>
          <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="التقرير">
            {([["clients", "العملاء: من لم يسدّد"], ["suppliers", "الموردون والفنادق"], ["employees", "الموظفون"]] as [Tab, string][]).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k} className={chip(tab === k)}>{label}</button>
            ))}
          </nav>
          {tab !== "clients" && (
            <nav className="mt-2 flex flex-wrap gap-1.5" aria-label="الفترة">
              {periods.map(([k, label]) => (
                <Link key={k} href={`/accounts/reports?period=${k}`} aria-current={r.period.key === k ? "page" : undefined} className={chip(r.period.key === k)}>{label}</Link>
              ))}
            </nav>
          )}
        </section>

        {tab === "clients" && (
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-semibold text-tv-text-faint">ما على العملاء اليوم، على كل الملفات القائمة — من لم يدفع شيئاً أولاً، ثم المتأخر عن قسطه، كلٌّ بأطول تأخير.</p>
              <Export onClick={() => save("العملاء-المستحقات", toCsv(["العميل", "الملف", "البائع", "الحالة", "أيام التأخير", "الإجمالي", "المدفوع", "المتبقي"], debts.map((d) => [d.client, d.serial, d.seller, STATE_AR[d.state], d.lateDays || "", d.total, d.paid, d.due])))} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(["unpaid", "overdue", "remaining"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setState(state === k ? "all" : k)} aria-pressed={state === k}
                  className={`rounded-xl p-3 text-start ${STATE_TONE[k]} ${state === k ? "ring-2 ring-tv-action-primary" : ""}`}>
                  <span className="block text-[11.5px] font-bold">{STATE_AR[k]} · {r.debts.totals[k].count}</span>
                  <span className="block text-lg font-extrabold"><Num>{sar(r.debts.totals[k].due)}</Num></span>
                </button>
              ))}
            </div>
            <Table empty="لا مستحقات على العملاء." head={["العميل", "الملف", "البائع", "الحالة", "المتبقي"]}
              rows={debts.map((d) => [
                <Link key="c" href={`/accounts/invoices/${d.id}`} className="text-tv-text-brand underline-offset-2 hover:underline">{d.client || "—"}</Link>,
                <Num key="s">{d.serial}</Num>,
                d.seller || "—",
                <span key="t" className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${STATE_TONE[d.state]}`}>{STATE_AR[d.state]}{d.lateDays ? ` · ${d.state === "overdue" ? "" : "متأخر "}${days(d.lateDays)}` : ""}</span>,
                <Num key="d">{sar(d.due)}</Num>,
              ])} />
          </section>
        )}

        {tab === "suppliers" && (
          <>
            <section className={card}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-extrabold text-tv-text-strong">الموردون — {tag}</h2>
                <Export onClick={() => save(`الموردون-${r.period.key}`, toCsv(["المورد", "الحجوزات", "تكلفة الحجوزات", "المدفوع له في الفترة"], r.spend.suppliers.map((s) => [s.name, s.bookings, s.booked, s.paid])))} />
              </div>
              <Table empty="لا حجوزات بتكلفة في هذه الفترة." head={["المورد", "الحجوزات", "تكلفة الحجوزات", "المدفوع له"]}
                rows={r.spend.suppliers.map((s) => [s.name, <Num key="b">{String(s.bookings)}</Num>, <Num key="c">{sar(s.booked)}</Num>, <Num key="p">{sar(s.paid)}</Num>])} />
            </section>
            <section className={card}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-extrabold text-tv-text-strong">الفنادق الأكثر دفعاً — {tag}</h2>
                <Export onClick={() => save(`الفنادق-${r.period.key}`, toCsv(["الفندق", "الحجوزات", "التكلفة"], r.spend.hotels.map((h) => [h.name, h.bookings, h.booked])))} />
              </div>
              <Table empty="لا حجوزات فنادق بتكلفة في هذه الفترة." head={["الفندق", "الحجوزات", "التكلفة"]}
                rows={r.spend.hotels.slice(0, 30).map((h) => [h.name, <Num key="b">{String(h.bookings)}</Num>, <Num key="c">{sar(h.booked)}</Num>])} />
            </section>
          </>
        )}

        {tab === "employees" && (
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-extrabold text-tv-text-strong">الموظفون — {tag}</h2>
                <p className="text-[12px] font-semibold text-tv-text-faint">الملفات التي أكّدها كل موظف ومبيعاتها مقابل هدفه، وما سجّله من عمليات مالية (دفعات العملاء والسداد للموردين).</p>
              </div>
              <Export onClick={() => save(`الموظفون-${r.period.key}`, toCsv(["الموظف", "ملفات مؤكدة", "المبيعات", "الهدف", "نسبة الإنجاز %", "الربح", "المحصّل", "عمليات مالية سجّلها"], r.employees.map((e) => [e.name, e.confirmed, e.sales, e.target, e.achieved, e.profit, e.collected, e.recorded])))} />
            </div>
            <Table empty="لا نتائج في هذه الفترة." head={["الموظف", "مؤكدة", "المبيعات", "الإنجاز من الهدف", "الربح", "المحصّل", "عمليات مالية"]}
              rows={r.employees.map((e) => [
                e.name || "—",
                <Num key="n">{String(e.confirmed)}</Num>,
                <Num key="s">{sar(e.sales)}</Num>,
                e.achieved == null ? <span key="a" className="text-tv-text-faint">بلا هدف</span> : (
                  <span key="a" className="flex min-w-36 items-center gap-2">
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-tv-surface-sunken" role="progressbar" aria-valuenow={e.achieved} aria-valuemin={0} aria-valuemax={100} aria-label={`${e.name}: ${e.achieved}% من الهدف`}>
                      <span className={`block h-full ${e.achieved >= 100 ? "bg-tv-status-success" : e.achieved >= 50 ? "bg-tv-action-primary" : "bg-tv-status-danger"}`} style={{ width: `${Math.min(100, e.achieved)}%` }} />
                    </span>
                    <Num className={e.achieved < 50 ? "text-tv-status-danger" : ""}>{`${e.achieved}%`}</Num>
                  </span>
                ),
                <Num key="p">{sar(e.profit)}</Num>,
                <Num key="c">{sar(e.collected)}</Num>,
                <Num key="r">{String(e.recorded)}</Num>,
              ])} />
          </section>
        )}
      </div>
    </>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="py-4 text-center text-[13px] font-semibold text-tv-text-faint">{empty}</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full">
        <thead><tr className="border-b border-tv-border-subtle">{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-tv-border-subtle">
          {rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k} className={td}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
