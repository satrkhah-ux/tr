"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import type { DuesView } from "@/lib/data/accounts";
import { payTermText, payTermTone, type PayTerm } from "@/lib/accounts/dues";
import { card, Num, sar } from "./ui";

/** «المستحقات» (stage 10): what we owe suppliers and when, what clients owe and when, what came in — each row opens its file. */

const ITEM_AR: Record<string, string> = { hotel: "فندق", flight: "طيران", transfer: "مواصلات", tour: "جولة", visa: "تأشيرة", insurance: "تأمين", service: "خدمة", train: "قطار" };
const tone = (t: PayTerm | null) => {
  if (!t) return "text-tv-text-faint";
  const v = payTermTone(t);
  return v === "danger" ? "text-tv-status-danger" : v === "warning" ? "text-tv-status-warning" : "text-tv-text-muted";
};
const chip = (on: boolean) =>
  `min-h-10 rounded-full border px-3 text-[12.5px] font-bold ${on ? "border-tv-action-primary bg-tv-action-primary text-tv-action-on-primary" : "border-tv-border-default text-tv-text-brand hover:bg-tv-surface-sunken"}`;
const daysText = (d: number | null) => (d == null ? "بلا تاريخ" : d === 0 ? "اليوم" : d > 0 ? `بعد ${d} يوم` : `متأخر ${-d} يوم`);

type Tab = "payables" | "installments" | "received";

export function DuesPage({ d }: { d: DuesView }) {
  const [tab, setTab] = useState<Tab>("payables");
  const owe = d.payables.filter((p) => p.currency === "SAR").reduce((s, p) => s + p.cost, 0);
  const urgent = d.payables.filter((p) => p.term && payTermTone(p.term) !== "calm").length;
  const due = d.installments.reduce((s, i) => s + i.left, 0);
  const late = d.installments.filter((i) => i.state === "overdue").length;
  const got = d.received.filter((r) => r.currency === "SAR").reduce((s, r) => s + (r.kind === "استرجاع" ? -r.amount : r.amount), 0);

  return (
    <div dir="rtl" className="tv-fade-up space-y-4">
      <section className={card}>
        <h1 className="flex items-center gap-2 text-lg font-extrabold text-tv-text-strong"><CalendarClock className="size-5" />المستحقات</h1>
        <p className="mt-1 text-[12px] font-semibold text-tv-text-faint">متى يُدفع كل مبلغ ولمن: للموردين بموعد الدفع أو الإلغاء المجاني على كل حجز، ومن العملاء بأقساطهم. كل سطر يفتح ملفه.</p>
        <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="المستحقات">
          <button type="button" onClick={() => setTab("payables")} aria-pressed={tab === "payables"} className={chip(tab === "payables")}>
            علينا للموردين · <Num>{sar(owe)}</Num>{urgent > 0 && <span className="ms-1 rounded-full bg-tv-status-danger px-1.5 text-[11px] text-white">{urgent}</span>}
          </button>
          <button type="button" onClick={() => setTab("installments")} aria-pressed={tab === "installments"} className={chip(tab === "installments")}>
            أقساط العملاء · <Num>{sar(due)}</Num>{late > 0 && <span className="ms-1 rounded-full bg-tv-status-danger px-1.5 text-[11px] text-white">{late}</span>}
          </button>
          <button type="button" onClick={() => setTab("received")} aria-pressed={tab === "received"} className={chip(tab === "received")}>
            ما وصل (90 يوماً) · <Num>{sar(got)}</Num>
          </button>
        </nav>
      </section>

      {tab === "payables" && (
        <section className={card}>
          {d.payables.length === 0 ? <p className="py-3 text-center text-[13px] font-semibold text-tv-text-faint">لا حجوزات مؤكدة غير مدفوعة.</p> : (
            <ul className="divide-y divide-tv-border-subtle">
              {d.payables.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-tv-text-strong">{p.title}</span>
                    <span className="block text-[11.5px] font-semibold text-tv-text-faint">
                      {ITEM_AR[p.kind] ?? p.kind}{p.city ? ` · ${p.city}` : ""}
                      {p.from ? (p.to && p.to !== p.from ? <> · من <Num>{p.from}</Num> إلى <Num>{p.to}</Num></> : <> · <Num>{p.from}</Num></>) : null}
                      {" · "}
                      {p.supplier_id ? <Link href={`/accounts/suppliers/${p.supplier_id}`} className="text-tv-text-brand hover:underline">{p.supplier}</Link> : p.supplier}
                      {" · "}
                      <Link href={`/operations/${p.operation_id}`} className="text-tv-text-brand hover:underline"><Num>{p.serial || "الملف"}</Num></Link>
                      {p.client ? ` — ${p.client}` : ""}
                    </span>
                    <span className={`mt-0.5 block text-[12px] font-extrabold ${tone(p.term)}`}>{p.term ? payTermText(p.term) : "لا موعد دفع مسجّل على الحجز"}</span>
                  </span>
                  <Num className="text-[13.5px] font-extrabold text-tv-text-strong">{sar(p.cost, p.currency)}</Num>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "installments" && (
        <section className={card}>
          {d.installments.length === 0 ? <p className="py-3 text-center text-[13px] font-semibold text-tv-text-faint">لا أقساط مستحقة.</p> : (
            <ul className="divide-y divide-tv-border-subtle">
              {d.installments.map((i, k) => (
                <li key={`${i.id}-${k}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="min-w-0 flex-1">
                    <Link href={`/accounts/invoices/${i.id}`} className="block text-[13px] font-bold text-tv-text-strong hover:underline">{i.client || "—"}</Link>
                    <span className="text-[11.5px] font-semibold text-tv-text-faint">
                      <Num>{i.serial}</Num> · {i.due_date ? <>يستحق <Num>{i.due_date}</Num></> : "قبل السفر"} · {i.agreed ? "حسب الاتفاق المالي" : "حسب الشروط العامة"}
                    </span>
                  </span>
                  <span className={`text-[12px] font-extrabold ${i.state === "overdue" ? "text-tv-status-danger" : i.days != null && i.days <= 3 ? "text-tv-status-warning" : "text-tv-text-muted"}`}>{daysText(i.days)}</span>
                  <Num className="text-[13.5px] font-extrabold text-tv-text-strong">{sar(i.left)}</Num>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "received" && (
        <section className={card}>
          {d.received.length === 0 ? <p className="py-3 text-center text-[13px] font-semibold text-tv-text-faint">لا دفعات في آخر 90 يوماً.</p> : (
            <ul className="divide-y divide-tv-border-subtle">
              {d.received.map((r, k) => (
                <li key={`${r.operation_id}-${k}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="min-w-0 flex-1">
                    <Link href={`/accounts/invoices/${r.operation_id}`} className="block text-[13px] font-bold text-tv-text-strong hover:underline">{r.client || "—"}</Link>
                    <span className="text-[11.5px] font-semibold text-tv-text-faint">
                      <Num>{r.on}</Num> · <Num>{r.serial}</Num> · {r.kind} · {r.method}{r.receipt_no ? <> · سند <Num>{r.receipt_no}</Num></> : null}
                    </span>
                  </span>
                  <Num className={`text-[13.5px] font-extrabold ${r.kind === "استرجاع" ? "text-tv-status-danger" : "text-tv-status-success"}`}>{`${r.kind === "استرجاع" ? "−" : ""}${sar(r.amount, r.currency)}`}</Num>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
