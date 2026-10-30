"use client";

import { Building2, Landmark, Scale, Target, Users, Wallet } from "lucide-react";
import type { CompanyStatus } from "@/lib/accounts/status";
import { profitTone } from "../operations/CaseProfitCard";
import { card, monthName, Num, sar } from "./ui";

/** «حالة الشركة» and «الخطط والاستراتيجيات» — the accounts home's head (stage 9). */

function Bar({ share, label }: { share: number | null; label: string }) {
  const v = share ?? 0;
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-tv-surface-sunken" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <span className={`block h-full ${v >= 100 ? "bg-tv-status-success" : v >= 50 ? "bg-tv-action-primary" : "bg-tv-status-danger"}`} style={{ width: `${Math.min(100, v)}%` }} />
      </span>
      <Num className="w-14 text-end text-[12px] font-extrabold">{share == null ? "—" : `${share}%`}</Num>
    </span>
  );
}

function Tile({ icon: Icon, label, value, hint, tone = "" }: { icon: typeof Wallet; label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className={`${card} !p-4`}>
      <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-tv-text-muted"><Icon className="size-3.5" />{label}</p>
      <p className={`mt-1.5 whitespace-nowrap text-xl font-extrabold sm:text-2xl ${tone || "text-tv-text-strong"}`}><Num>{value}</Num></p>
      <p className="mt-0.5 text-[11px] font-semibold text-tv-text-faint">{hint}</p>
    </div>
  );
}

export function CompanyStatusPanel({ s, receivable, supplierOwed }: { s: CompanyStatus; receivable: number; supplierOwed: number }) {
  return (
    <div className="space-y-4">
      <section aria-labelledby="company-status">
        <h2 id="company-status" className="mb-2 flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-wide text-tv-text-muted">
          <Building2 className="size-4" />حالة الشركة — {monthName(s.month)}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile icon={Landmark} label="الخزينة" value={sar(s.treasury)} hint="من «الحسابات المالية»" />
          <Tile icon={Wallet} label="لنا على العملاء" value={sar(receivable)} hint="الباقي على الملفات القائمة" />
          <Tile icon={Scale} label="ديون الشركة" value={sar(s.debts.left)} hint={`أقساط شهرية ${sar(s.debts.monthly)}`} tone="text-tv-status-danger" />
          <Tile icon={Users} label="علينا للموردين" value={sar(supplierOwed)} hint="حجوزات مؤكدة لم تُسدَّد" />
          <Tile icon={Wallet} label="صافي الشهر" value={sar(s.net.month)} hint={`بعد الرواتب والإيجارات والأقساط ${sar(s.net.fixedMonth)}`} tone={profitTone(s.net.month)} />
          <Tile icon={Wallet} label={`صافي ${s.quarter.label}`} value={sar(s.net.quarter)} hint="حتى هذا الشهر" tone={profitTone(s.net.quarter)} />
          <div className={`${card} col-span-2 !p-4`}>
            <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-tv-text-muted"><Target className="size-3.5" />نقطة التعادل</p>
            <p className="mt-1.5 text-[13px] font-bold text-tv-text-strong">
              المطلوب <Num>{sar(s.breakEven.need)}</Num> ربحاً هذا الشهر · تحقق <Num className={profitTone(s.breakEven.made - s.breakEven.need)}>{sar(s.breakEven.made)}</Num>
            </p>
            <div className="mt-2"><Bar share={s.breakEven.share} label="ما تحقق من نقطة التعادل" /></div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-2 text-[15px] font-extrabold text-tv-text-strong">ديون الشركة</h2>
          {s.debts.top.length === 0 ? (
            <p className="text-[13px] font-semibold text-tv-text-faint">لا ديون مفتوحة.</p>
          ) : (
            <ul className="divide-y divide-tv-border-subtle">
              {s.debts.top.map((d) => (
                <li key={d.creditor} className="flex items-center justify-between gap-3 py-2 text-[13px] font-bold">
                  <span className="truncate text-tv-text-strong">{d.creditor}</span>
                  <span className="text-end">
                    <Num className="block text-tv-text-strong">{sar(d.left)}</Num>
                    {d.monthly > 0 && <span className="text-[11px] font-semibold text-tv-text-faint">قسط <Num>{sar(d.monthly)}</Num></span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={card}>
          <h2 className="mb-1 text-[15px] font-extrabold text-tv-text-strong">توزيع {s.quarter.label}</h2>
          <p className="mb-2 text-[11.5px] font-semibold text-tv-text-faint">ربح الربع حتى الآن، بعد نصيب الخزينة والمصروفات والرواتب والإيجارات والأقساط.</p>
          <p className={`text-2xl font-extrabold ${profitTone(s.split.distributable)}`}><Num>{sar(s.split.distributable)}</Num></p>
          <ul className="mt-2 divide-y divide-tv-border-subtle">
            {s.split.shares.map((p) => (
              <li key={p.name} className="flex items-center justify-between py-1.5 text-[13px] font-bold">
                <span className="text-tv-text-strong">{p.name} <Num className="text-tv-text-faint">{`${p.share}%`}</Num></span>
                <Num className="text-tv-text-strong">{sar(p.amount)}</Num>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {s.plans.length > 0 && (
        <section className={card} aria-labelledby="plans">
          <h2 id="plans" className="mb-3 text-[15px] font-extrabold text-tv-text-strong">الخطط والاستراتيجيات</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {s.plans.map((p) => (
              <article key={p.month} className="rounded-xl border border-tv-border-subtle p-3">
                <h3 className="text-[14px] font-extrabold text-tv-text-brand">{monthName(p.month)}</h3>
                <dl className="mt-2 space-y-2 text-[12px] font-bold text-tv-text-muted">
                  <div><dt>المبيعات <Num>{sar(p.sales.actual)}</Num> من <Num>{sar(p.sales.target)}</Num></dt><dd><Bar share={p.sales.share} label="المبيعات من الهدف" /></dd></div>
                  <div><dt>الربح <Num>{sar(p.profit.actual)}</Num> من <Num>{sar(p.profit.target)}</Num></dt><dd><Bar share={p.profit.share} label="الربح من الهدف" /></dd></div>
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
      )}
    </div>
  );
}
