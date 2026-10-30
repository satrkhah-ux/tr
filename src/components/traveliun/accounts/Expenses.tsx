"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowRight, Receipt, Trash2 } from "lucide-react";
import { addExpense, deleteExpense } from "@/lib/data/accounts-actions";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_AR, EXPENSE_METHODS, EXPENSE_METHOD_AR, type Expense } from "@/lib/accounts/expenses";
import { card, monthName, Num, sar } from "./ui";

/** «المصروفات» — the company's spending outside the trips, by month (finance.accounts; the actions check). */

const field = "tv-field min-h-10 w-full rounded-lg border border-tv-border-default bg-tv-surface-raised px-3 text-[13px]";
const back = "inline-flex h-9 items-center gap-2 rounded-[9px] border border-tv-border-default bg-tv-surface-raised px-3 text-[12.5px] font-bold text-tv-text-muted hover:bg-tv-surface-sunken";

export function ExpensesView({ data, today }: { data: { month: string; months: string[]; rows: Expense[]; totals: { total: number; byCategory: { category: Expense["category"]; amount: number }[] } }; today: string }) {
  const empty = { spent_on: today, category: "ads", title: "", amount: "", method: "bank_transfer", note: "" };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = () =>
    start(async () => {
      const r = await addExpense({ ...form, amount: Number(form.amount.replace(/,/g, "")) });
      if (r.ok) { setForm({ ...empty, spent_on: form.spent_on, category: form.category, method: form.method }); setError(""); }
      else setError(r.error);
    });
  const remove = (x: Expense) => {
    if (!window.confirm(`حذف «${x.title}»؟`)) return;
    start(async () => {
      const r = await deleteExpense(x.id);
      setError(r.ok ? "" : r.error);
    });
  };

  return (
    <>
      <div dir="rtl" className="tv-fade-up mx-auto max-w-4xl space-y-4">
        <Link href="/accounts" className={back}><ArrowRight className="size-4" />الحسابات</Link>
        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-extrabold text-tv-text-strong"><Receipt className="size-5" />المصروفات — {monthName(data.month)}</h1>
              <p className="mt-1 text-3xl font-extrabold text-tv-text-strong"><Num>{sar(data.totals.total)}</Num></p>
              <p className="mt-1 text-[12px] font-semibold text-tv-text-faint">ما تصرفه الشركة خارج الرحلات. الرواتب والإيجارات في «الحسابات المالية».</p>
            </div>
            <nav className="flex flex-wrap gap-1.5" aria-label="اختر الشهر">
              {data.months.map((m) => (
                <Link key={m} href={`/accounts/expenses?month=${m}`} aria-current={m === data.month ? "page" : undefined}
                  className={`rounded-full border px-3 py-1 text-[12px] font-bold ${m === data.month ? "border-tv-action-primary bg-tv-action-primary text-tv-action-on-primary" : "border-tv-border-default text-tv-text-brand hover:bg-tv-surface-sunken"}`}>
                  {monthName(m)}
                </Link>
              ))}
            </nav>
          </div>
          {data.totals.byCategory.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {data.totals.byCategory.map((c) => (
                <li key={c.category} className="rounded-full bg-tv-surface-sunken px-3 py-1 text-[12px] font-bold text-tv-text-muted">
                  {EXPENSE_CATEGORY_AR[c.category]}: <Num className="text-tv-text-strong">{sar(c.amount)}</Num>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <h2 className="mb-3 text-[15px] font-extrabold text-tv-text-strong">أضف مصروفاً</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[12.5px] font-bold text-tv-text-muted">البند<input value={form.title} onChange={set("title")} maxLength={200} placeholder="مثال: حملة إعلانات سناب" className={`${field} mt-1`} /></label>
            <label className="text-[12.5px] font-bold text-tv-text-muted">المبلغ (ر.س)<input value={form.amount} onChange={set("amount")} inputMode="decimal" placeholder="0" className={`${field} mt-1`} /></label>
            <label className="text-[12.5px] font-bold text-tv-text-muted">النوع
              <select value={form.category} onChange={set("category")} className={`${field} mt-1`}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_AR[c]}</option>)}</select></label>
            <label className="text-[12.5px] font-bold text-tv-text-muted">طريقة الدفع
              <select value={form.method} onChange={set("method")} className={`${field} mt-1`}>{EXPENSE_METHODS.map((m) => <option key={m} value={m}>{EXPENSE_METHOD_AR[m]}</option>)}</select></label>
            <label className="text-[12.5px] font-bold text-tv-text-muted">التاريخ<input type="date" value={form.spent_on} max={today} onChange={set("spent_on")} className={`${field} mt-1`} /></label>
            <label className="text-[12.5px] font-bold text-tv-text-muted">ملاحظة<input value={form.note} onChange={set("note")} maxLength={1000} className={`${field} mt-1`} /></label>
          </div>
          {error && <p role="alert" className="mt-2 text-[12.5px] font-bold text-tv-status-danger">{error}</p>}
          <button type="button" onClick={save} disabled={pending || !form.title.trim() || !form.amount} className="mt-3 min-h-11 w-full rounded-xl bg-tv-action-primary text-[14px] font-extrabold text-tv-action-on-primary disabled:opacity-50 sm:w-auto sm:px-8">
            {pending ? "لحظة…" : "حفظ المصروف"}
          </button>
        </section>

        <section className={card}>
          {data.rows.length === 0 ? (
            <p className="py-3 text-center text-[13px] font-semibold text-tv-text-faint">لا مصروفات مسجّلة في {monthName(data.month)}.</p>
          ) : (
            <ul className="divide-y divide-tv-border-subtle">
              {data.rows.map((x) => (
                <li key={x.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-tv-text-strong">{x.title}</span>
                    <span className="text-[11.5px] font-semibold text-tv-text-faint">
                      <Num>{x.spent_on}</Num> · {EXPENSE_CATEGORY_AR[x.category]} · {EXPENSE_METHOD_AR[x.method]}{x.note ? ` · ${x.note}` : ""}
                    </span>
                  </span>
                  <Num className="text-[13px] font-extrabold text-tv-text-strong">{sar(x.amount, x.currency)}</Num>
                  <button type="button" onClick={() => remove(x)} disabled={pending} aria-label={`حذف ${x.title}`} className="flex size-10 items-center justify-center rounded-lg text-tv-status-danger hover:bg-tv-status-danger-bg">
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
