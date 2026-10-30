"use client";

import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, BadgePercent, ClipboardCheck, Gavel, Landmark, Lock, Siren, TrendingUp, Truck, Wallet } from "lucide-react";
import type { AccountsHomeView } from "@/lib/data/accounts";
import { MONTHS } from "@/lib/finance/model";
import { EXPENSE_CATEGORY_AR } from "@/lib/accounts/expenses";
import { profitTone } from "../operations/CaseProfitCard";
import { AreaLines, Bars, Ring, StackBar } from "./Charts";
import { BreakEvenNote, DebtsCard, PlansCard, SplitCard } from "./Status";
import { card, money, monthName, Num, sar } from "./ui";

/**
 * «الحسابات» — the financial section's home (finance.accounts; the loader checks), drawn as a dashboard
 * (the owner, 2026-10-31: «قريب على هذا وافضل منه»): the company's figures first, the six months' curve and
 * the break-even ring, the month, the debts and the plans. Riyals; read-only.
 */

const shortMonth = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1];
const days = (n: number) => (n === 1 ? "يوم" : n === 2 ? "يومين" : n <= 10 ? `${n} أيام` : `${n} يوماً`);

type Tone = "indigo" | "orange" | "green" | "red";
const CHIP: Record<Tone, string> = {
  indigo: "bg-[var(--acc-indigo)]/12 text-[var(--acc-indigo)]",
  orange: "bg-[var(--acc-orange)]/15 text-[var(--acc-orange)]",
  green: "bg-tv-status-success-bg text-tv-status-success",
  red: "bg-tv-status-danger-bg text-tv-status-danger",
};

function Stat({ icon: Icon, label, value, hint, tone, valueTone = "" }: { icon: typeof Wallet; label: string; value: string; hint: string; tone: Tone; valueTone?: string }) {
  return (
    <div className={card}>
      <p className="flex items-center gap-2.5 text-[12.5px] font-bold text-tv-text-muted">
        <span className={`flex size-9 items-center justify-center rounded-2xl ${CHIP[tone]}`}><Icon className="size-[18px]" /></span>
        {label}
      </p>
      <p className={`mt-3 whitespace-nowrap text-[18px] font-light leading-none sm:text-[28px] ${valueTone || "text-tv-text-strong"}`}><Num>{value}</Num></p>
      <p className="mt-1.5 text-[11.5px] font-semibold text-tv-text-faint">{hint}</p>
    </div>
  );
}

export function AccountsHome({ home }: { home: AccountsHomeView }) {
  const s = home.status;
  const links: [string, string, typeof Wallet][] = [
    ["/operations", "الحالات والدفعات", ClipboardCheck],
    ...(home.reports
      ? ([["/operations/cashflow", "التدفق النقدي", Wallet], ["/operations/profitability", "تقرير الربحية", TrendingUp]] as [string, string, typeof Wallet][])
      : []),
    ["/commissions/cycles", "العمولات", BadgePercent],
    ["/financial-terms", "الشروط المالية", Landmark],
  ];
  const up = home.net >= 0;

  return (
    <div dir="rtl" className="tv-fade-up space-y-5">
      {/* the company today */}
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {s ? (
          <Stat icon={Landmark} label="الخزينة" value={sar(s.treasury)} hint="من «الحسابات المالية»" tone="indigo" />
        ) : (
          <Stat icon={TrendingUp} label="صافي المبيعات" value={sar(home.sales)} hint={`${home.count} ملف مؤكد هذا الشهر`} tone="indigo" />
        )}
        <Stat icon={ArrowUp} label="لنا على العملاء" value={sar(home.receivable)} hint="الباقي على الملفات القائمة" tone="green" />
        <Stat icon={ArrowDown} label="علينا للموردين" value={sar(home.supplierOwed)} hint="حجوزات مؤكدة لم تُسدَّد" tone="orange" />
        {s ? (
          <Stat icon={Wallet} label="صافي الشهر" value={money(s.net.month)} hint={`بعد الثابت ${sar(s.net.fixedMonth)} · ${s.quarter.label} ${money(s.net.quarter)}`} tone={s.net.month < 0 ? "red" : "green"} valueTone={profitTone(s.net.month)} />
        ) : (
          <Stat icon={Wallet} label="المحصَّل هذا الشهر" value={sar(home.collected)} hint="دفعات العملاء ناقص الاسترجاع" tone="indigo" />
        )}
      </div>

      {/* six months and the break-even */}
      <div className="grid gap-5 lg:grid-cols-12">
        <section className={`${card} lg:col-span-8`}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-extrabold text-tv-text-strong">المبيعات والربح</h2>
            <span className="rounded-full bg-tv-surface-sunken px-3 py-1 text-[11.5px] font-bold text-tv-text-muted">آخر ستة أشهر</span>
          </div>
          <AreaLines
            labels={home.trend.map((t) => shortMonth(t.month))}
            series={[{ name: "المبيعات", values: home.trend.map((t) => t.sales) }, { name: "الربح عند الإصدار", values: home.trend.map((t) => t.profit) }]}
          />
        </section>
        <section className={`${card} flex flex-col items-center gap-3 lg:col-span-4`}>
          <h2 className="self-start text-[15px] font-extrabold text-tv-text-strong">{s ? "نقطة التعادل" : "هامش الربح"}</h2>
          <p className="-mt-2 self-start text-[11.5px] font-semibold text-tv-text-faint">{s ? `ما تحقق من ربح ${monthName(s.month)}` : `ربح ${monthName(home.month)} من مبيعاته`}</p>
          <Ring share={s ? s.breakEven.share : home.margin} caption={s ? "ما تحقق من نقطة التعادل" : "هامش الربح"} />
          {s && <BreakEvenNote s={s} />}
          {s && s.plans.length > 0 && (
            <a href="#plans" className="mt-auto inline-flex min-h-10 items-center rounded-full bg-tv-action-primary px-6 text-[13px] font-bold text-tv-action-on-primary shadow-[var(--acc-shadow)] hover:bg-tv-action-primary-hover">خطة الشهر</a>
          )}
        </section>
      </div>

      {/* the month */}
      <div className="grid gap-5 lg:grid-cols-12">
        <section className={`${card} lg:col-span-4`}>
          <nav className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="اختر الشهر">
            {home.months.map((m) => (
              <Link key={m} href={`/accounts?month=${m}`} aria-current={m === home.month ? "page" : undefined}
                className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-bold ${m === home.month ? "bg-tv-action-primary text-tv-action-on-primary" : "bg-tv-surface-sunken text-tv-text-muted hover:text-tv-text-brand"}`}>
                {shortMonth(m)}
              </Link>
            ))}
          </nav>
          <p className="text-[12.5px] font-bold text-tv-text-muted">صافي الربح — {monthName(home.month)}</p>
          <p className={`mt-1 flex items-center gap-2 text-[34px] font-light leading-tight ${profitTone(home.net)}`}>
            {up ? <ArrowUp className="size-7 text-[var(--acc-indigo)]" /> : <ArrowDown className="size-7 text-[var(--acc-orange)]" />}
            <Num>{money(home.net)}</Num>
          </p>
          <p className="mt-1 text-[11.5px] font-semibold text-tv-text-faint">
            ربح المبيعات <Num>{sar(home.profit)}</Num>{home.margin != null && <> · الهامش <Num>{`${home.margin}%`}</Num></>}
          </p>
          <hr className="my-4 border-tv-border-subtle" />
          <p className="text-[12.5px] font-bold text-tv-text-muted">المصروفات</p>
          <p className="mt-1 flex items-center gap-2 text-[26px] font-light leading-tight text-tv-text-strong">
            <ArrowDown className="size-6 text-[var(--acc-orange)]" />
            <Num>{sar(home.expenses.total)}</Num>
          </p>
          <p className="mt-1 text-[11.5px] font-semibold text-tv-text-faint">
            {home.expenses.byCategory[0] ? `أكبرها ${EXPENSE_CATEGORY_AR[home.expenses.byCategory[0].category]}` : "لم يُسجَّل مصروف"} — الرواتب والإيجارات في «الحسابات المالية»
          </p>
          {s && home.expenses.byCategory.length > 0 && (
            <div className="mt-3"><StackBar parts={home.expenses.byCategory.map((e) => ({ label: `${EXPENSE_CATEGORY_AR[e.category]} ${sar(e.amount)}`, value: e.amount }))} /></div>
          )}
          {home.ownerFixed != null && (
            <p className="mt-3 flex flex-wrap items-center gap-1.5 rounded-2xl bg-tv-surface-sunken px-3 py-2 text-[12px] font-bold text-tv-text-muted">
              <Lock className="size-3.5" />
              الرواتب والإيجارات والأقساط <Num>{sar(home.ownerFixed)}</Num>
              <span aria-hidden>·</span>
              الصافي بعدها <Num className={profitTone(home.net - home.ownerFixed)}>{money(home.net - home.ownerFixed)}</Num>
              <span className="w-full text-[11px] font-semibold text-tv-text-faint">تظهر لك وحدك</span>
            </p>
          )}
        </section>

        <section className={`${card} lg:col-span-4`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-extrabold text-tv-text-strong">المبيعات أسبوعاً بأسبوع</h2>
            <span className="text-[11.5px] font-bold text-tv-text-faint">{monthName(home.month)} · ر.س</span>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            {([["المبيعات", Math.round(home.sales).toLocaleString("en-US"), ""], ["المحصَّل", Math.round(home.collected).toLocaleString("en-US"), ""], ["المتأخر", Math.round(home.overdue.amount).toLocaleString("en-US"), home.overdue.amount > 0 ? "text-tv-status-danger" : ""]] as const).map(([k, v, t]) => (
              <div key={k} className="rounded-2xl bg-tv-surface-sunken px-1.5 py-2">
                <dt className="text-[11px] font-bold text-tv-text-faint">{k}</dt>
                <dd className={`mt-0.5 whitespace-nowrap text-[12.5px] font-extrabold ${t || "text-tv-text-strong"}`}><Num>{v}</Num></dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <Bars labels={home.weeks.map((_, i) => `أسبوع ${i + 1}`)} series={[{ name: "المبيعات", values: home.weeks.map((w) => w.amount) }]} />
          </div>
          <p className="mt-1 text-[11.5px] font-semibold text-tv-text-faint"><Num>{String(home.count)}</Num> ملف مؤكد{home.other > 0 && ` · ${home.other} بعملة أخرى لم تُجمع`}</p>
        </section>

        <div className="min-w-0 lg:col-span-4">
          {s ? (
            <SplitCard s={s} />
          ) : (
            <section className={card}>
              <h2 className="mb-3 text-[15px] font-extrabold text-tv-text-strong">المصروفات حسب البند</h2>
              {home.expenses.byCategory.length ? <StackBar parts={home.expenses.byCategory.map((e) => ({ label: `${EXPENSE_CATEGORY_AR[e.category]} ${sar(e.amount)}`, value: e.amount }))} /> : <p className="text-[13px] font-semibold text-tv-text-faint">لم يُسجَّل مصروف.</p>}
            </section>
          )}
        </div>
      </div>

      {home.alerts.length > 0 && (
        <section className={card} aria-labelledby="finance-alerts">
          <h2 id="finance-alerts" className="mb-1 flex items-center gap-2 text-[15px] font-extrabold text-tv-status-danger">
            <span className="flex size-8 items-center justify-center rounded-xl bg-tv-status-danger-bg"><Siren className="size-4" /></span>
            الإنذارات المالية <Num>{String(home.alerts.length)}</Num>
          </h2>
          <p className="mb-2 text-[11.5px] font-semibold text-tv-text-faint">تصل الإدارة والحسابات صباحاً مرة واحدة لكل إنذار. «اقترح قراراً» يفتح «القرارات الإدارية» بنصٍّ جاهز تراجعه الإدارة وتصدره — لا يصدر شيء تلقائياً.</p>
          <ul className="grid gap-2 md:grid-cols-2">
            {home.alerts.slice(0, 12).map((a) => (
              <li key={a.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-tv-surface-sunken px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-tv-text-strong">{a.title}</span>
                  <span className="text-[11.5px] font-semibold text-tv-text-faint">{a.detail}</span>
                </span>
                <Link href={a.href} className="inline-flex min-h-9 items-center rounded-full bg-tv-surface-raised px-3 text-[12px] font-bold text-tv-text-brand shadow-sm">افتح</Link>
                {home.canDecide && a.decision && (
                  <Link
                    href={`/employees/decisions?draft=${encodeURIComponent(a.decision.text)}${a.decision.employee_id ? `&for=${a.decision.employee_id}` : ""}`}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-tv-action-primary px-3 text-[12px] font-bold text-tv-action-on-primary"
                  >
                    <Gavel className="size-3.5" />
                    اقترح قراراً
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {s && <DebtsCard s={s} />}
        <section className={card}>
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-extrabold text-tv-text-strong">
            <AlertTriangle className="size-4 text-tv-status-danger" />
            الفواتير المتأخرة
          </h2>
          {home.overdue.invoices.length === 0 ? (
            <p className="py-3 text-[13px] font-semibold text-tv-text-faint">لا قسط متأخر اليوم.</p>
          ) : (
            <ul className="space-y-1">
              {home.overdue.invoices.slice(0, 8).map((i) => (
                <li key={i.id}>
                  <Link href={`/accounts/invoices/${i.id}`} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-tv-surface-sunken">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-tv-text-strong">{home.clients[i.id] ?? "—"}</span>
                      <span className="text-[11.5px] font-semibold text-tv-text-faint"><Num>{i.serial}</Num> · متأخر منذ {days(i.days)}</span>
                    </span>
                    <span className="rounded-full bg-tv-status-danger-bg px-2.5 py-1 text-[12px] font-extrabold text-tv-status-danger"><Num>{sar(i.amount)}</Num></span>
                    <ArrowLeft className="size-4 text-tv-text-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={card}>
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-extrabold text-tv-text-strong">
            <Truck className="size-4 text-tv-text-brand" />
            أكبر الموردين هذا الشهر
          </h2>
          {home.suppliers.length === 0 ? (
            <p className="py-3 text-[13px] font-semibold text-tv-text-faint">لا حجوزات بتكلفة على ملفات هذا الشهر.</p>
          ) : (
            <ul className="space-y-1">
              {home.suppliers.map((sp) => (
                <li key={sp.name} className="flex items-center gap-3 px-1 py-1.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-[var(--acc-indigo)]/12 text-[12px] font-extrabold text-[var(--acc-indigo)]">{sp.name.slice(0, 2)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-tv-text-strong">{sp.name}</span>
                    <span className="text-[11.5px] font-semibold text-tv-text-faint">{sp.bookings} حجز</span>
                  </span>
                  <Num className="text-[13px] font-extrabold text-tv-text-brand">{sar(sp.amount)}</Num>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {s && <PlansCard s={s} />}

      <nav aria-label="من ترافليون" className="flex flex-wrap gap-2 pb-2">
        {links.map(([href, label, Icon]) => (
          <Link key={href} href={href} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-tv-surface-raised px-4 text-[12.5px] font-bold text-tv-text-brand shadow-[var(--acc-shadow)] hover:text-tv-action-primary-hover">
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
