"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, BadgePercent, Gavel, Siren, ClipboardCheck, Landmark, Lock, TrendingUp, Truck, Wallet } from "lucide-react";
import type { AccountsHomeView } from "@/lib/data/accounts";
import { profitTone } from "../operations/CaseProfitCard";
import { card, monthName, Num, sar } from "./ui";
import { EXPENSE_CATEGORY_AR } from "@/lib/accounts/expenses";

/** «الحسابات» — the financial section's home (finance.accounts; the loader checks). Riyals; read-only. */

export function AccountsHome({ home }: { home: AccountsHomeView }) {
  const actions: [string, string, typeof Wallet][] = [
    ["/operations", "الحالات والدفعات", ClipboardCheck],
    ...(home.reports
      ? ([["/operations/cashflow", "التدفق النقدي", Wallet], ["/operations/profitability", "تقرير الربحية", TrendingUp]] as [string, string, typeof Wallet][])
      : []),
    ["/commissions/cycles", "العمولات", BadgePercent],
    ["/financial-terms", "الشروط المالية", Landmark],
  ];
  return (
    <>
      <div dir="rtl" className="tv-fade-up mx-auto max-w-5xl space-y-4">
        {/* the month: its net profit first, as «قائمة» opens */}
        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-bold text-tv-text-muted">صافي الربح — {monthName(home.month)}</p>
              <p className={`mt-1 text-3xl font-extrabold ${profitTone(home.net)}`}>
                <Num>{sar(home.net)}</Num>
              </p>
              <p className="mt-1 text-[12px] font-semibold text-tv-text-faint">
                ربح المبيعات المؤكدة <Num>{sar(home.profit)}</Num>
                {home.margin != null && (
                  <>
                    {" "}(الهامش <Num>{`${home.margin}%`}</Num>)
                  </>
                )}{" "}
                ناقص المصروفات <Num>{sar(home.expenses.total)}</Num> — الرواتب والإيجارات في «الحسابات المالية»
              </p>
              {home.ownerFixed != null && (
                <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-tv-surface-sunken px-3 py-1.5 text-[12.5px] font-bold text-tv-text-muted">
                  <Lock className="size-3.5" />
                  الرواتب والإيجارات والأقساط <Num>{sar(home.ownerFixed)}</Num>
                  <span aria-hidden>·</span>
                  الصافي بعدها <Num className={profitTone(home.net - home.ownerFixed)}>{sar(home.net - home.ownerFixed)}</Num>
                  <span className="font-semibold text-tv-text-faint">— من «الحسابات المالية»، تظهر لك وحدك</span>
                </p>
              )}
            </div>
            <nav className="flex flex-wrap gap-1.5" aria-label="اختر الشهر">
              {home.months.map((m) => (
                <Link
                  key={m}
                  href={`/accounts?month=${m}`}
                  aria-current={m === home.month ? "page" : undefined}
                  className={`rounded-full border px-3 py-1 text-[12px] font-bold ${m === home.month ? "border-tv-action-primary bg-tv-action-primary text-tv-action-on-primary" : "border-tv-border-default text-tv-text-brand hover:bg-tv-surface-sunken"}`}
                >
                  {monthName(m)}
                </Link>
              ))}
            </nav>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {actions.map(([href, label, Icon]) => (
              <Link key={href} href={href} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-tv-border-default px-3 text-[12.5px] font-bold text-tv-text-brand hover:bg-tv-surface-sunken">
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </div>
        </section>

        {home.alerts.length > 0 && (
          <section className={`${card} border-tv-status-danger/30`} aria-labelledby="finance-alerts">
            <h2 id="finance-alerts" className="mb-1 flex items-center gap-2 text-[15px] font-extrabold text-tv-status-danger">
              <Siren className="size-4" />
              الإنذارات المالية <Num>{String(home.alerts.length)}</Num>
            </h2>
            <p className="mb-2 text-[11.5px] font-semibold text-tv-text-faint">تصل الإدارة والحسابات صباحاً مرة واحدة لكل إنذار. «اقترح قراراً» يفتح «القرارات الإدارية» بنصٍّ جاهز تراجعه الإدارة وتصدره — لا يصدر شيء تلقائياً.</p>
            <ul className="divide-y divide-tv-border-subtle">
              {home.alerts.slice(0, 12).map((a) => (
                <li key={a.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-tv-text-strong">{a.title}</span>
                    <span className="text-[11.5px] font-semibold text-tv-text-faint">{a.detail}</span>
                  </span>
                  <Link href={a.href} className="inline-flex min-h-9 items-center rounded-full border border-tv-border-default px-3 text-[12px] font-bold text-tv-text-brand hover:bg-tv-surface-sunken">افتح</Link>
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

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Kpi label="صافي المبيعات" value={sar(home.sales)} hint={`${home.count} ملف مؤكد هذا الشهر`} />
          <Kpi label="المحصَّل هذا الشهر" value={sar(home.collected)} hint="دفعات العملاء ناقص الاسترجاع" />
          <Kpi label="المستحق على العملاء" value={sar(home.receivable)} hint="الباقي على كل الملفات القائمة اليوم" />
          <Kpi label="المتأخر" value={sar(home.overdue.amount)} hint={`${home.overdue.invoices.length} ملف`} danger={home.overdue.amount > 0} />
          <Kpi label="المصروفات هذا الشهر" value={sar(home.expenses.total)} hint={home.expenses.byCategory[0] ? `أكبرها ${EXPENSE_CATEGORY_AR[home.expenses.byCategory[0].category]}` : "لم يُسجَّل مصروف"} />
          <Kpi label="علينا للموردين" value={sar(home.supplierOwed)} hint="حجوزات مؤكدة لم تُسدَّد بعد" />
        </div>

        <section className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-extrabold text-tv-text-strong">المبيعات أسبوعاً بأسبوع</h2>
            <span className="text-[12px] font-semibold text-tv-text-faint">{monthName(home.month)}</span>
          </div>
          <WeeksChart weeks={home.weeks} />
          {home.other > 0 && <p className="mt-2 text-[12px] font-semibold text-tv-status-warning">{home.other} ملف هذا الشهر بعملة غير الريال — لم يُجمع مع الأرقام.</p>}
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className={card}>
            <h2 className="mb-2 flex items-center gap-2 text-[15px] font-extrabold text-tv-text-strong">
              <AlertTriangle className="size-4 text-tv-status-danger" />
              الفواتير المتأخرة
            </h2>
            {home.overdue.invoices.length === 0 ? (
              <p className="py-3 text-[13px] font-semibold text-tv-text-faint">لا قسط متأخر اليوم.</p>
            ) : (
              <ul className="divide-y divide-tv-border-subtle">
                {home.overdue.invoices.slice(0, 8).map((i) => (
                  <li key={i.id}>
                    <Link href={`/accounts/invoices/${i.id}`} className="flex items-center gap-3 py-2.5 hover:bg-tv-surface-sunken">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-tv-text-strong">{home.clients[i.id] ?? "—"}</span>
                        <span className="text-[11.5px] font-semibold text-tv-text-faint">
                          <Num>{i.serial}</Num> · متأخر منذ {i.days} {i.days === 1 ? "يوم" : i.days === 2 ? "يومين" : i.days <= 10 ? "أيام" : "يوماً"}
                        </span>
                      </span>
                      <span className="rounded-full bg-tv-status-danger-bg px-2.5 py-1 text-[12px] font-extrabold text-tv-status-danger">
                        <Num>{sar(i.amount)}</Num>
                      </span>
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
              <ul className="divide-y divide-tv-border-subtle">
                {home.suppliers.map((s) => (
                  <li key={s.name} className="flex items-center gap-3 py-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-tv-surface-sunken text-[12px] font-extrabold text-tv-text-brand">{s.name.slice(0, 2)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-tv-text-strong">{s.name}</span>
                      <span className="text-[11.5px] font-semibold text-tv-text-faint">{s.bookings} حجز</span>
                    </span>
                    <Num className="text-[13px] font-extrabold text-tv-text-brand">{sar(s.amount)}</Num>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, hint, danger = false }: { label: string; value: string; hint: string; danger?: boolean }) {
  return (
    <div className={`${card} ${danger ? "border-tv-status-danger/30 bg-tv-status-danger-bg" : ""}`}>
      <p className="text-[12px] font-bold text-tv-text-muted">{label}</p>
      <p className={`mt-1 whitespace-nowrap text-lg font-extrabold sm:text-xl ${danger ? "text-tv-status-danger" : "text-tv-text-strong"}`}>
        <Num>{value}</Num>
      </p>
      <p className="mt-0.5 text-[11.5px] font-semibold text-tv-text-faint">{hint}</p>
    </div>
  );
}

/** A plain line over the month's five weeks — the first on the right, as the page reads. */
function WeeksChart({ weeks }: { weeks: { label: string; amount: number }[] }) {
  const W = 600, H = 150, pad = 18;
  const max = Math.max(...weeks.map((w) => w.amount), 1);
  const x = (i: number) => W - pad - (i * (W - 2 * pad)) / (weeks.length - 1);
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const points = weeks.map((w, i) => `${x(i)},${y(w.amount)}`).join(" ");
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full text-tv-text-brand" role="img" aria-label={weeks.map((w) => `${w.label}: ${sar(w.amount)}`).join("، ")}>
        <polygon points={`${x(0)},${H - pad} ${points} ${x(weeks.length - 1)},${H - pad}`} className="fill-current opacity-10" />
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {weeks.map((w, i) => (
          <circle key={w.label} cx={x(i)} cy={y(w.amount)} r={3.5} className="fill-current" />
        ))}
      </svg>
      <figcaption className="mt-1 grid grid-cols-5 text-center text-[11px] font-semibold text-tv-text-faint">
        {weeks.map((w) => (
          <span key={w.label}>
            {w.label}
            <br />
            <Num className="font-bold text-tv-text-muted">{Math.round(w.amount).toLocaleString("en-US")}</Num>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
