"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowRight, CalendarDays, CheckCircle2, CreditCard, FileText, Repeat, Share2, UserRound } from "lucide-react";
import type { InvoiceDetail, InvoiceRow } from "@/lib/data/accounts";
import { confirmInvoice } from "@/lib/data/accounts-actions";
import { INVOICE_STATUS_AR, type InvoiceStatus } from "@/lib/accounts/invoice";
import { KIND_AR } from "@/lib/operations/payments";
import { TraveliunShell } from "../TraveliunShell";
import { card, Num, sar } from "./ui";

/** «الفواتير» — the internal invoices (finance.accounts; the loaders check). */

const TONE: Record<InvoiceStatus, string> = {
  paid: "bg-tv-status-success-bg text-tv-status-success",
  partial: "bg-tv-status-warning-bg text-tv-status-warning",
  overdue: "bg-tv-status-danger-bg text-tv-status-danger",
  due: "bg-tv-surface-sunken text-tv-text-brand",
};
export const StatusChip = ({ status }: { status: InvoiceStatus }) => (
  <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-extrabold ${TONE[status]}`}>{INVOICE_STATUS_AR[status]}</span>
);
const back = "inline-flex h-9 items-center gap-2 rounded-[9px] border border-tv-border-default bg-tv-surface-raised px-3 text-[12.5px] font-bold text-tv-text-muted hover:bg-tv-surface-sunken";

const FILTERS: ["all" | InvoiceStatus, string][] = [["all", "الكل"], ["overdue", "متأخرة"], ["due", "مستحقة"], ["partial", "مسددة جزئياً"], ["paid", "مسددة"]];

export function InvoicesList({ rows, counts }: { rows: InvoiceRow[]; counts: Record<InvoiceStatus | "all", number> }) {
  const [filter, setFilter] = useState<"all" | InvoiceStatus>("all");
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  return (
    <TraveliunShell title="nav.accounts">
      <div dir="rtl" className="tv-fade-up mx-auto max-w-5xl space-y-4">
        <Link href="/accounts" className={back}><ArrowRight className="size-4" />الحسابات</Link>
        <section className={card}>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-tv-text-strong"><FileText className="size-5" />الفواتير</h1>
          <p className="mt-1 text-[12px] font-semibold text-tv-text-faint">فاتورة داخلية لكل ملف مؤكد، رقمها من رقم الملف. ملفات الشركاء تُفوتر للشريك ولا تظهر هنا.</p>
          <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="حالة الفاتورة">
            {FILTERS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                className={`min-h-10 rounded-full border px-3 text-[12.5px] font-bold ${filter === k ? "border-tv-action-primary bg-tv-action-primary text-tv-action-on-primary" : "border-tv-border-default text-tv-text-brand hover:bg-tv-surface-sunken"}`}>
                {label} <Num>{String(counts[k])}</Num>
              </button>
            ))}
          </nav>
        </section>
        <section className={card}>
          {shown.length === 0 ? (
            <p className="py-4 text-center text-[13px] font-semibold text-tv-text-faint">لا فواتير هنا.</p>
          ) : (
            <ul className="divide-y divide-tv-border-subtle">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link href={`/accounts/invoices/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:bg-tv-surface-sunken">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold text-tv-text-strong">{r.client || "—"}</span>
                      <span className="text-[11.5px] font-semibold text-tv-text-faint">
                        <Num>{r.number}</Num> · <Num>{r.date}</Num>
                        {r.confirmed && <CheckCircle2 className="ms-1 inline size-3.5 text-tv-status-success" aria-label="مؤكدة" />}
                      </span>
                    </span>
                    <span className="text-end">
                      <span className="block text-[13px] font-extrabold text-tv-text-strong"><Num>{sar(r.total ?? 0, r.currency)}</Num></span>
                      {r.due > 0 && <span className="text-[11.5px] font-semibold text-tv-text-faint">المستحق <Num>{sar(r.due, r.currency)}</Num></span>}
                    </span>
                    <StatusChip status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}

export function InvoicePage({ inv }: { inv: InvoiceDetail }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const confirm = () =>
    start(async () => {
      const r = await confirmInvoice(inv.id);
      setError(r.ok ? "" : r.error);
    });
  return (
    <TraveliunShell title="nav.accounts">
      <div dir="rtl" className="tv-fade-up mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/accounts/invoices" className={back}><ArrowRight className="size-4" />الفواتير</Link>
          <a href={`/accounts/invoices/${inv.id}/print`} target="_blank" rel="noopener" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-tv-border-default bg-tv-surface-raised px-4 text-[12.5px] font-bold text-tv-text-brand hover:bg-tv-surface-sunken">
            <Share2 className="size-4" />المشاركة كـ PDF
          </a>
        </div>
        <InvoicePaper inv={inv} />
        <section className={card}>
          {inv.confirmation ? (
            <p className="flex items-center gap-2 text-[13px] font-bold text-tv-status-success"><CheckCircle2 className="size-5" />أكّدها {inv.confirmation.by || "الحسابات"} يوم <Num>{inv.confirmation.at}</Num></p>
          ) : (
            <>
              <button type="button" onClick={confirm} disabled={pending} className="min-h-11 w-full rounded-xl bg-tv-action-primary text-[14px] font-extrabold text-tv-action-on-primary disabled:opacity-50">
                {pending ? "لحظة…" : "تأكيد الفاتورة"}
              </button>
              <p className="mt-2 text-center text-[11.5px] font-semibold text-tv-text-faint">راجعتُ المبلغ والدفعات مع الملف. يُسجَّل باسمك ووقته.</p>
            </>
          )}
          {error && <p role="alert" className="mt-2 text-[12.5px] font-bold text-tv-status-danger">{error}</p>}
        </section>
      </div>
    </TraveliunShell>
  );
}

const ITEM_AR: Record<string, string> = { hotel: "فندق", flight: "طيران", transfer: "مواصلات", tour: "جولة", visa: "تأشيرة", insurance: "تأمين", service: "خدمة", train: "قطار" };

/** The invoice itself — the same on the screen and on the printed PDF; only what the client may read. */
export function InvoicePaper({ inv }: { inv: InvoiceDetail }) {
  const row = (Icon: typeof UserRound, label: string, value: React.ReactNode) => (
    <div className="flex items-center gap-3 border-b border-tv-border-subtle py-3 last:border-0">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tv-surface-sunken text-tv-text-brand"><Icon className="size-4" /></span>
      <span className="min-w-0">
        <span className="block text-[11.5px] font-semibold text-tv-text-faint">{label}</span>
        <span className="block text-[13.5px] font-bold text-tv-text-strong">{value}</span>
      </span>
    </div>
  );
  return (
    <>
      <section className={card}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-bold text-tv-text-muted">الرصيد المستحق</p>
            <p className="mt-1 text-3xl font-extrabold text-tv-text-strong"><Num>{sar(inv.due, inv.currency)}</Num></p>
            <p className="mt-1 text-[12px] font-semibold text-tv-text-faint">
              الإجمالي <Num>{sar(inv.total ?? 0, inv.currency)}</Num> · المدفوع <Num>{sar(inv.paid, inv.currency)}</Num>
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="text-[13px] font-extrabold text-tv-text-brand"><Num>{inv.number}</Num></span>
            <StatusChip status={inv.status} />
          </div>
        </div>
      </section>
      <section className={card}>
        {row(UserRound, "العميل", inv.client || "—")}
        {row(CalendarDays, "تاريخ الفاتورة", <Num>{inv.date}</Num>)}
        {row(Repeat, "شروط الدفع", inv.terms)}
        {row(CreditCard, "طريقة الدفع", inv.methods.length ? inv.methods.join("، ") : "—")}
        {row(FileText, "الطلب المصدر", <>{<Num>{inv.source.serial}</Num>}{inv.source.destination ? ` — ${inv.source.destination}` : ""}{inv.source.travel_start ? <> · السفر <Num>{inv.source.travel_start}</Num></> : null}</>)}
      </section>
      {inv.items.length > 0 && (
        <section className={card}>
          <h2 className="mb-1 text-[15px] font-extrabold text-tv-text-strong">البنود</h2>
          <ul className="divide-y divide-tv-border-subtle">
            {inv.items.map((it, i) => (
              <li key={i} className="py-2.5">
                <span className="block text-[13px] font-bold text-tv-text-strong">{it.title}</span>
                <span className="text-[11.5px] font-semibold text-tv-text-faint">
                  {ITEM_AR[it.kind] ?? it.kind}{it.city ? ` · ${it.city}` : ""}
                  {it.from ? (it.to && it.to !== it.from ? <> · من <Num>{it.from}</Num> إلى <Num>{it.to}</Num></> : <> · <Num>{it.from}</Num></>) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={card}>
        <h2 className="mb-1 text-[15px] font-extrabold text-tv-text-strong">الدفعات المتفق عليها</h2>
        <ul className="divide-y divide-tv-border-subtle">
          {inv.schedule.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-[13px] font-bold">
              <span className="text-tv-text-muted">{r.due_date ? <Num>{r.due_date}</Num> : "قبل السفر"}</span>
              <Num className="text-tv-text-strong">{sar(r.amount, inv.currency)}</Num>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${TONE[r.state === "paid" ? "paid" : r.state === "overdue" ? "overdue" : r.state === "partial" ? "partial" : "due"]}`}>
                {r.state === "paid" ? "مسدد" : r.state === "overdue" ? "متأخر" : r.state === "partial" ? "جزئي" : "مستحق"}
              </span>
            </li>
          ))}
        </ul>
        {inv.receipts.length > 0 && (
          <>
            <h3 className="mb-1 mt-3 text-[13px] font-extrabold text-tv-text-strong">ما وصل</h3>
            <ul className="divide-y divide-tv-border-subtle">
              {inv.receipts.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-[12.5px] font-semibold text-tv-text-muted">
                  <span>{p.on ? <Num>{p.on}</Num> : "—"} · {KIND_AR[p.kind as keyof typeof KIND_AR] ?? p.kind}{p.receipt_no ? <> · سند <Num>{p.receipt_no}</Num></> : null}</span>
                  <Num className={`font-extrabold ${p.kind === "refund" ? "text-tv-status-danger" : "text-tv-status-success"}`}>{`${p.kind === "refund" ? "−" : ""}${sar(p.amount, inv.currency)}`}</Num>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
