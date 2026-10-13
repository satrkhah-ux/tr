"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, TrendingUp, Wallet } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { Cashflow, ProfitReport } from "@/lib/data/operation-money";
import type { CashBucket, ProfitRow } from "@/lib/operations/money";
import type { TranslationKey } from "@/lib/i18n";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { fmtMoney, marginText, profitTone } from "./CaseProfitCard";

/** The internal money pages: «تقرير الربحية» and «التدفق النقدي». pricing.internal — the loaders check. */

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const back =
  "inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]";
const th = "px-2.5 py-2 text-start text-[11px] font-bold text-[#93aaa3] whitespace-nowrap";
const td = "px-2.5 py-2 text-[12px] font-bold text-[#0f3d38] whitespace-nowrap";

function Page({ title, hint, icon, children }: { title: TranslationKey; hint: TranslationKey; icon: ReactNode; children: ReactNode }) {
  const { t } = useTraveliunUI();
  return (
    <TraveliunShell title="nav.operations">
      <div className="tv-fade-up space-y-4">
        <Link href="/operations" className={back}>
          <ArrowRight className="size-4 ltr:rotate-180" />
          {t("ops.backToBoard")}
        </Link>
        <section className={card}>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
            {icon}
            {t(title)}
            <span className="rounded-full bg-[#fff8e8] px-2 py-0.5 text-[10.5px] font-bold text-[#a86a10]">{t("ops.money.internal")}</span>
          </h1>
          <p className="mt-1 text-[12px] font-semibold text-[#93aaa3]">{t(hint)}</p>
        </section>
        {children}
      </div>
    </TraveliunShell>
  );
}

const Num = ({ children, tone }: { children: string; tone?: string }) => (
  <span className={`tv-tnum ${tone ?? ""}`}>
    <DirText dir="ltr">{children}</DirText>
  </span>
);

/** On the board, for pricing.internal holders: where the company's money is read. */
export function MoneyLinks() {
  const { t } = useTraveliunUI();
  const pill =
    "inline-flex items-center gap-1 rounded-full border border-[#dbe6e1] px-3 py-1 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6]";
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      <Link href="/operations/cashflow" className={pill}>
        <Wallet className="size-3.5" />
        {t("ops.money.cashflow")}
      </Link>
      <Link href="/operations/profitability" className={pill}>
        <TrendingUp className="size-3.5" />
        {t("ops.money.report")}
      </Link>
      <Link href="/operations/suppliers" className={pill}>
        {t("ops.sup.accounts")}
      </Link>
    </div>
  );
}

// --------------------------------------------------------------- profit ----

export function ProfitabilityReport({ report }: { report: ProfitReport }) {
  const { t } = useTraveliunUI();
  const field = "h-10 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[13px] text-[#185045]";
  return (
    <Page title="ops.money.report" hint="ops.money.reportHint" icon={<TrendingUp className="size-5" />}>
      {/* a plain GET form: the range is in the URL, so a report can be bookmarked or sent */}
      <form method="get" className={`${card} flex flex-wrap items-end gap-2`}>
        <label className="grid gap-1.5 text-[11.5px] font-bold text-[#185045]">
          {t("ops.money.from")}
          <input type="month" name="from" defaultValue={report.from} dir="ltr" className={field} />
        </label>
        <label className="grid gap-1.5 text-[11.5px] font-bold text-[#185045]">
          {t("ops.money.to")}
          <input type="month" name="to" defaultValue={report.to} dir="ltr" className={field} />
        </label>
        <button type="submit" className="inline-flex h-10 items-center rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439]">
          {t("ops.money.show")}
        </button>
        <span className="ms-auto text-[12px] font-bold text-[#93aaa3]">
          {t("ops.money.cases")}: <Num>{String(report.cases)}</Num>
        </span>
      </form>

      <ProfitTable title={t("ops.money.total")} rows={report.total.map((r) => ({ ...r, key: t("ops.money.total") }))} />
      <ProfitTable title={t("ops.money.byMonth")} rows={report.byMonth} />
      <ProfitTable title={t("ops.money.byEmployee")} rows={report.byEmployee} />
      <ProfitTable title={t("ops.money.byDestination")} rows={report.byDestination} />
    </Page>
  );
}

function ProfitTable({ title, rows }: { title: string; rows: (ProfitRow & { key: string })[] }) {
  const { t } = useTraveliunUI();
  return (
    <section className={card}>
      <h2 className="text-sm font-extrabold text-[#185045]">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-[12px] font-semibold text-[#93aaa3]">{t("ops.money.noFigures")}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#e2ebe7]">
                <th className={th} />
                <th className={th}>{t("ops.money.cases")}</th>
                <th className={th}>{t("ops.money.currency")}</th>
                <th className={th}>{t("ops.money.sale")}</th>
                <th className={th}>{`${t("ops.money.expected")} · ${t("ops.money.profit")}`}</th>
                <th className={th}>{t("ops.money.margin")}</th>
                <th className={th}>{t("ops.money.revenue")}</th>
                <th className={th}>{t("ops.money.cost")}</th>
                <th className={th}>{`${t("ops.money.actual")} · ${t("ops.money.profit")}`}</th>
                <th className={th}>{t("ops.money.margin")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                // a group's second currency shares its name and case count with the first
                const first = i === 0 || rows[i - 1].key !== r.key;
                return (
                  <tr key={`${r.key}|${r.currency}`} className={first ? "border-t border-[#eef4f1]" : ""}>
                    <td className={td}>{first ? r.key || t("ops.money.unknown") : ""}</td>
                    <td className={td}>{first ? <Num>{String(r.cases)}</Num> : null}</td>
                    <td className={td}>
                      <DirText dir="ltr">{r.currency}</DirText>
                    </td>
                    <td className={td}>
                      <Num>{fmtMoney(r.expected.revenue, r.currency)}</Num>
                    </td>
                    <td className={td}>
                      <Num tone={profitTone(r.expected.profit)}>{fmtMoney(r.expected.profit, r.currency)}</Num>
                    </td>
                    <td className={td}>
                      <Num tone={profitTone(r.expected.profit)}>{marginText(r.expected.margin)}</Num>
                    </td>
                    <td className={td}>
                      <Num>{fmtMoney(r.actual.revenue, r.currency)}</Num>
                    </td>
                    <td className={td}>
                      <Num>{fmtMoney(r.actual.cost, r.currency)}</Num>
                    </td>
                    <td className={td}>
                      <Num tone={profitTone(r.actual.profit)}>{fmtMoney(r.actual.profit, r.currency)}</Num>
                    </td>
                    <td className={td}>
                      <Num tone={profitTone(r.actual.profit)}>{marginText(r.actual.margin)}</Num>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------ cash flow ----

export function CashflowView({ cashflow }: { cashflow: Cashflow }) {
  return (
    <Page title="ops.money.cashflow" hint="ops.money.cashflowHint" icon={<Wallet className="size-5" />}>
      <div className="space-y-3">
        {cashflow.buckets.map((b, i) => (
          <Bucket key={i} bucket={b} />
        ))}
      </div>
    </Page>
  );
}

function Bucket({ bucket }: { bucket: CashBucket }) {
  const { t } = useTraveliunUI();
  const overdue = bucket.key === "overdue";
  const title =
    bucket.key === "week" ? (
      <DirText dir="ltr">{`${bucket.from} → ${bucket.to}`}</DirText>
    ) : (
      t(overdue ? "ops.money.overdue" : "ops.money.later")
    );
  return (
    <section className={`${card} ${overdue && bucket.items.length > 0 ? "border-[#f2c7c7]" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className={`tv-tnum text-sm font-extrabold ${overdue && bucket.items.length > 0 ? "text-[#c22850]" : "text-[#185045]"}`}>{title}</h2>
        {bucket.lines.length === 0 ? (
          <span className="text-[12px] font-semibold text-[#93aaa3]">{t("ops.money.nothingDue")}</span>
        ) : (
          <div className="grid gap-1">
            {bucket.lines.map((l) => (
              <p key={l.currency} className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-bold text-[#557d78]">
                <span>
                  {t("ops.money.in")} <Num tone="text-[#0f7a52]">{fmtMoney(l.in, l.currency)}</Num>
                </span>
                <span>
                  {t("ops.money.out")} <Num tone="text-[#a86a10]">{fmtMoney(l.out, l.currency)}</Num>
                </span>
                <span>
                  {t("ops.money.net")} <Num tone={`font-extrabold ${profitTone(l.net)}`}>{fmtMoney(l.net, l.currency)}</Num>
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
      {bucket.items.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11.5px] font-bold text-[#2aa87a]">
            <Num>{String(bucket.items.length)}</Num>
          </summary>
          <ul className="mt-2 divide-y divide-[#eef4f1]">
            {bucket.items.map((i, n) => (
              <li key={n} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[12px] font-bold text-[#557d78]">
                <span className="min-w-0">
                  <span className={i.direction === "in" ? "text-[#0f7a52]" : "text-[#a86a10]"}>{t(`ops.money.kind.${i.kind}` as TranslationKey)}</span>
                  {i.operation_id ? (
                    <Link href={`/operations/${i.operation_id}`} className="ms-2 text-[#185045] hover:underline">
                      <DirText dir="ltr">{i.serial}</DirText>
                    </Link>
                  ) : (
                    <DirText dir="ltr" className="ms-2">
                      {i.serial}
                    </DirText>
                  )}
                  {i.title ? <span className="ms-2 font-semibold text-[#93aaa3]">{i.title}</span> : null}
                </span>
                <span className="flex items-center gap-3">
                  <Num tone="text-[#93aaa3]">{i.date ?? t("ops.money.noDate")}</Num>
                  <Num tone="text-[#0f3d38]">{`${i.direction === "out" ? "−" : "+"}${fmtMoney(i.amount, i.currency)}`}</Num>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
