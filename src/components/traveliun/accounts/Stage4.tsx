"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Download, FilePlus2, FileSpreadsheet } from "lucide-react";
import type { QuotesView } from "@/lib/accounts/quotes";
import { ACCOUNTS, journalCsv, type AccountKey, type JournalEntry } from "@/lib/accounts/journal";
import { canOpenPath } from "@/lib/roles/section-access";
import { useRole } from "@/lib/roles/RoleContext";
import { TraveliunShell } from "../TraveliunShell";
import { card, monthName, Num, sar } from "./ui";

/** «عروض الأسعار» and «القيود اليومية» in «الحسابات» (finance.accounts; the loaders check). */

const back = "inline-flex h-9 items-center gap-2 rounded-[9px] border border-tv-border-default bg-tv-surface-raised px-3 text-[12.5px] font-bold text-tv-text-muted hover:bg-tv-surface-sunken";
const pill = (on: boolean) =>
  `rounded-full border px-3 py-1 text-[12px] font-bold ${on ? "border-tv-action-primary bg-tv-action-primary text-tv-action-on-primary" : "border-tv-border-default text-tv-text-brand hover:bg-tv-surface-sunken"}`;

function Months({ months, month, path }: { months: string[]; month: string; path: string }) {
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="اختر الشهر">
      {months.map((m) => (
        <Link key={m} href={`${path}?month=${m}`} aria-current={m === month ? "page" : undefined} className={pill(m === month)}>{monthName(m)}</Link>
      ))}
    </nav>
  );
}

export function QuotesPage({ q }: { q: QuotesView & { months: string[] } }) {
  const { can } = useRole();
  return (
    <TraveliunShell title="nav.accounts">
      <div dir="rtl" className="tv-fade-up mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/accounts" className={back}><ArrowRight className="size-4" />الحسابات</Link>
          {canOpenPath("/basic", can) && (
            <Link href="/basic" className="inline-flex min-h-10 items-center gap-2 rounded-full bg-tv-action-primary px-4 text-[12.5px] font-bold text-tv-action-on-primary">
              <FilePlus2 className="size-4" />إنشاء عرض سعر
            </Link>
          )}
        </div>
        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-lg font-extrabold text-tv-text-strong">عروض الأسعار — {monthName(q.month)}</h1>
            <Months months={q.months} month={q.month} path="/accounts/quotes" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="عروض الشهر" value={sar(q.made.value)} hint={`${q.made.count} عرض`} />
            <Stat label="تحوّلت إلى بيع" value={sar(q.won.value)} hint={`${q.won.count} عرض`} />
            <Stat label="نسبة التحويل" value={q.conversion == null ? "—" : `${q.conversion}%`} hint="المؤكدة ÷ عروض الشهر" />
            <Stat label="المفتوحة الآن" value={sar(q.openValue)} hint={`${q.open.filter((o) => o.lapse !== "expired").length} عرض ساري`} />
          </div>
        </section>
        <section className={card}>
          <h2 className="mb-1 text-[15px] font-extrabold text-tv-text-strong">عروض لم تُحسم بعد</h2>
          {q.open.length === 0 ? (
            <p className="py-3 text-[13px] font-semibold text-tv-text-faint">لا عروض مفتوحة.</p>
          ) : (
            <ul className="divide-y divide-tv-border-subtle">
              {q.open.slice(0, 50).map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-tv-text-strong">{o.client || "—"}</span>
                    <span className="text-[11.5px] font-semibold text-tv-text-faint"><Num>{o.serial}</Num> · {o.seller || "—"} · <Num>{o.date}</Num></span>
                  </span>
                  <Num className="text-[13px] font-extrabold text-tv-text-strong">{o.sar == null ? "—" : sar(o.sar)}</Num>
                  {o.lapse && (
                    <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-extrabold ${o.lapse === "expired" ? "bg-tv-surface-sunken text-tv-text-faint" : "bg-tv-status-warning-bg text-tv-status-warning"}`}>
                      {o.lapse === "expired" ? "انتهت صلاحيته" : "ينتهي قريباً"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl bg-tv-surface-sunken p-3">
      <p className="text-[11.5px] font-bold text-tv-text-muted">{label}</p>
      <p className="mt-0.5 whitespace-nowrap text-lg font-extrabold text-tv-text-strong"><Num>{value}</Num></p>
      <p className="text-[11px] font-semibold text-tv-text-faint">{hint}</p>
    </div>
  );
}

export function JournalPage({ j }: { j: { month: string; months: string[]; entries: JournalEntry[]; totals: { account: AccountKey; debit: number; credit: number }[]; balanced: boolean; left: number } }) {
  const download = () => {
    const blob = new Blob([journalCsv(j.entries)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `قيود-${j.month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const amount = (n: number) => (n ? <Num>{Math.round(n).toLocaleString("en-US")}</Num> : null);
  return (
    <TraveliunShell title="nav.accounts">
      <div dir="rtl" className="tv-fade-up mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/accounts" className={back}><ArrowRight className="size-4" />الحسابات</Link>
          <button type="button" onClick={download} disabled={!j.entries.length} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-tv-border-default bg-tv-surface-raised px-4 text-[12.5px] font-bold text-tv-text-brand hover:bg-tv-surface-sunken disabled:opacity-40">
            <Download className="size-4" />تصدير للمحاسب (Excel)
          </button>
        </div>
        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-extrabold text-tv-text-strong"><BookOpen className="size-5" />القيود اليومية — {monthName(j.month)}</h1>
              <p className="mt-1 text-[12px] font-semibold text-tv-text-faint">تُكتب وحدها مما سُجّل في النظام: البيع عند تأكيد الملف، ودفعات العملاء، والسداد للموردين، والمصروفات. بالريال.</p>
            </div>
            <Months months={j.months} month={j.month} path="/accounts/journal" />
          </div>
          <p className={`mt-2 text-[12.5px] font-bold ${j.balanced ? "text-tv-status-success" : "text-tv-status-danger"}`}>
            {j.balanced ? "✓ المدين يساوي الدائن" : "⚠ المدين لا يساوي الدائن — بلّغ المطوّر"}
            {j.left > 0 && <span className="ms-2 text-tv-status-warning">· {j.left} حركة بعملة أخرى أو لملف شريك لم تُقيَّد</span>}
          </p>
        </section>

        <section className={card}>
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-extrabold text-tv-text-strong"><FileSpreadsheet className="size-4" />ميزان الشهر</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-[12.5px]">
              <thead><tr className="text-tv-text-faint"><th className="py-1.5 text-start">الحساب</th><th className="text-start">مدين</th><th className="text-start">دائن</th></tr></thead>
              <tbody className="divide-y divide-tv-border-subtle font-bold text-tv-text-strong">
                {j.totals.map((t) => (
                  <tr key={t.account}><td className="py-1.5"><Num className="text-tv-text-faint">{ACCOUNTS[t.account].code}</Num> {ACCOUNTS[t.account].name}</td><td>{amount(t.debit)}</td><td>{amount(t.credit)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={card}>
          {j.entries.length === 0 ? (
            <p className="py-3 text-center text-[13px] font-semibold text-tv-text-faint">لا قيود في {monthName(j.month)}.</p>
          ) : (
            <ul className="space-y-3">
              {j.entries.map((e, i) => (
                <li key={i} className="rounded-xl border border-tv-border-subtle p-3">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] font-bold text-tv-text-strong">
                    <span>{e.memo}</span>
                    <span className="text-[11.5px] text-tv-text-faint"><Num>{e.date}</Num>{e.ref ? <> · <Num>{e.ref}</Num></> : null}</span>
                  </p>
                  <table className="mt-1.5 w-full text-[12px]">
                    <tbody>
                      {e.lines.map((l, k) => (
                        <tr key={k} className="text-tv-text-muted">
                          <td className={`py-0.5 ${l.credit ? "ps-6" : ""}`}>{l.credit ? "إلى " : "من "}{ACCOUNTS[l.account].name}{l.detail ? ` — ${l.detail}` : ""}</td>
                          <td className="w-28 text-end font-bold text-tv-text-strong">{amount(l.debit)}</td>
                          <td className="w-28 text-end font-bold text-tv-text-strong">{amount(l.credit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}
