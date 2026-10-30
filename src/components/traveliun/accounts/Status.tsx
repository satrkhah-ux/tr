"use client";

import { Target } from "lucide-react";
import type { CompanyStatus } from "@/lib/accounts/status";
import { profitTone } from "../operations/CaseProfitCard";
import { Donut } from "./Charts";
import { card, monthName, Num, sar } from "./ui";

/** «حالة الشركة»' cards on the accounts home (stage 9): the debts, the quarter's split, the plans. */

export function Bar({ share, label }: { share: number | null; label: string }) {
  const v = share ?? 0;
  return (
    <span className="flex items-center gap-2">
      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--acc-track)]" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <span className={`block h-full rounded-full ${v >= 100 ? "bg-tv-status-success" : v >= 50 ? "bg-gradient-to-l from-[var(--acc-indigo)] to-[var(--acc-indigo-soft)]" : "bg-gradient-to-l from-[var(--acc-orange)] to-[var(--acc-orange-soft)]"}`} style={{ width: `${Math.min(100, v)}%` }} />
      </span>
      <Num className="w-12 text-end text-[12px] font-extrabold">{share == null ? "—" : `${share}%`}</Num>
    </span>
  );
}

export function DebtsCard({ s }: { s: CompanyStatus }) {
  const total = s.debts.left || 1;
  return (
    <section className={card}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-extrabold text-tv-text-strong">ديون الشركة</h2>
        <span className="text-[12px] font-bold text-tv-text-faint">أقساط شهرية <Num>{sar(s.debts.monthly)}</Num></span>
      </div>
      <p className="mt-1 text-[26px] font-light text-tv-status-danger"><Num>{sar(s.debts.left)}</Num></p>
      {s.debts.top.length === 0 ? (
        <p className="mt-2 text-[13px] font-semibold text-tv-text-faint">لا ديون مفتوحة.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {s.debts.top.map((d) => (
            <li key={d.creditor} className="text-[12.5px] font-bold">
              <span className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-tv-text-strong">{d.creditor}</span>
                <Num className="text-tv-text-muted">{sar(d.left)}</Num>
              </span>
              <span className="block h-2 overflow-hidden rounded-full bg-[var(--acc-track)]">
                <span className="block h-full rounded-full bg-gradient-to-l from-[var(--acc-orange)] to-[var(--acc-orange-soft)]" style={{ width: `${Math.max(3, (d.left / total) * 100)}%` }} />
              </span>
              {d.monthly > 0 && <span className="mt-0.5 block text-[11px] font-semibold text-tv-text-faint">قسط <Num>{sar(d.monthly)}</Num> شهرياً</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SplitCard({ s }: { s: CompanyStatus }) {
  return (
    <section className={card}>
      <h2 className="text-[15px] font-extrabold text-tv-text-strong">توزيع {s.quarter.label}</h2>
      <p className="mt-0.5 text-[11.5px] font-semibold text-tv-text-faint">ربح الربع حتى الآن بعد الخزينة والمصروفات والرواتب والإيجارات والأقساط.</p>
      <p className={`mt-1 text-[26px] font-light ${profitTone(s.split.distributable)}`}><Num>{sar(s.split.distributable)}</Num></p>
      <div className="mt-3">
        <Donut center="نصيب الشركاء" parts={s.split.shares.map((p) => ({ label: `${p.name} · ${sar(p.amount)}`, value: p.share }))} />
      </div>
    </section>
  );
}

export function BreakEvenNote({ s }: { s: CompanyStatus }) {
  return (
    <p className="text-center text-[12.5px] font-semibold text-tv-text-muted">
      المطلوب <Num className="font-extrabold text-tv-text-strong">{sar(s.breakEven.need)}</Num> ربحاً هذا الشهر لتغطية الرواتب والإيجارات والأقساط · تحقق{" "}
      <Num className={`font-extrabold ${profitTone(s.breakEven.made - s.breakEven.need)}`}>{sar(s.breakEven.made)}</Num>
    </p>
  );
}

export function PlansCard({ s }: { s: CompanyStatus }) {
  if (s.plans.length === 0) return null;
  return (
    <section id="plans" className={card} aria-labelledby="plans-title">
      <h2 id="plans-title" className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-tv-text-strong"><Target className="size-4 text-tv-text-brand" />الخطط والاستراتيجيات</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {s.plans.map((p) => (
          <article key={p.month} className="rounded-[18px] bg-tv-surface-sunken p-4">
            <h3 className="text-[14px] font-extrabold text-tv-text-brand">{monthName(p.month)}</h3>
            <dl className="mt-2 space-y-2.5 text-[12px] font-bold text-tv-text-muted">
              <div><dt>المبيعات <Num>{sar(p.sales.actual)}</Num> من <Num>{sar(p.sales.target)}</Num></dt><dd className="mt-1"><Bar share={p.sales.share} label="المبيعات من الهدف" /></dd></div>
              <div><dt>الربح <Num>{sar(p.profit.actual)}</Num> من <Num>{sar(p.profit.target)}</Num></dt><dd className="mt-1"><Bar share={p.profit.share} label="الربح من الهدف" /></dd></div>
              {p.debtBudget > 0 && <div><dt>ميزانية السداد <Num>{sar(p.debtBudget)}</Num></dt></div>}
            </dl>
            {p.focus.length > 0 && (
              <>
                <h4 className="mt-3 text-[12px] font-extrabold text-tv-text-strong">ماذا نركز</h4>
                <ul className="mt-1 list-disc space-y-1 ps-5 text-[12px] font-semibold text-tv-text-muted">{p.focus.map((f) => <li key={f}>{f}</li>)}</ul>
              </>
            )}
            {p.payments.length > 0 && (
              <>
                <h4 className="mt-3 text-[12px] font-extrabold text-tv-text-strong">خطة السداد</h4>
                <ul className="mt-1 list-disc space-y-1 ps-5 text-[12px] font-semibold text-tv-text-muted">{p.payments.map((f) => <li key={f}>{f}</li>)}</ul>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
