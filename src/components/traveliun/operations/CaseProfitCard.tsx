"use client";

import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { CaseProfitView } from "@/lib/data/operation-money";
import type { Money, MoneyLine } from "@/lib/operations/money";
import { useTraveliunUI } from "../TraveliunUIProvider";

export const fmtMoney = (amount: number, currency: string) =>
  `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;

export const marginText = (m: number | null) => (m == null ? "—" : `${m}%`);

/** Green when we earn, red when we lose — the one thing a manager reads first. */
export const profitTone = (n: number) => (n > 0 ? "text-[#0f7a52]" : n < 0 ? "text-[#c22850]" : "text-[#557d78]");

const amountIn = (list: Money[], currency: string) => list.find((m) => m.currency === currency)?.amount ?? 0;

/**
 * «ربحية الحالة» — internal. Rendered only when the page's loader returned
 * figures, which it does for pricing.internal alone.
 */
/** `showReport`: the link to the all-cases report — the manager's (operation-money.ts). */
export function CaseProfitCard({ profit, showReport }: { profit: CaseProfitView; showReport: boolean }) {
  const { t } = useTraveliunUI();
  return (
    <section className="tv-card rounded-2xl border p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-extrabold text-[#185045]">
          <TrendingUp className="size-4" />
          {t("ops.money.caseTitle")}
          <span className="rounded-full bg-[#fff8e8] px-2 py-0.5 text-[10.5px] font-bold text-[#a86a10]">{t("ops.money.internal")}</span>
        </h2>
        {showReport ? (
          <Link href="/operations/profitability" className="text-[12px] font-bold text-[#2aa87a] hover:underline">
            {t("ops.money.report")}
          </Link>
        ) : null}
      </div>
      <p className="mt-1 text-[11.5px] font-semibold text-tv-text-faint">{t("ops.money.caseHint")}</p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Side
          title={t("ops.money.expected")}
          lines={profit.expected}
          rows={(l) => [[profit.partner ? t("ops.money.invoice") : t("ops.money.sale"), l.revenue], [t("ops.money.cost"), l.cost]]}
        />
        <Side
          title={t("ops.money.actual")}
          lines={profit.actual}
          rows={(l) => [
            [profit.partner ? t("ops.money.invoice") : t("ops.money.received"), l.revenue],
            [t("ops.money.supplierPaid"), amountIn(profit.supplierPaid, l.currency)],
            [t("ops.money.supplierOwed"), amountIn(profit.supplierOwed, l.currency)],
          ]}
        />
      </div>
    </section>
  );
}

function Side({ title, lines, rows }: { title: string; lines: MoneyLine[]; rows: (l: MoneyLine) => [string, number][] }) {
  const { t } = useTraveliunUI();
  return (
    <div className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
      <p className="text-[11.5px] font-bold text-tv-text-faint">{title}</p>
      {lines.length === 0 ? <p className="mt-2 text-[12px] font-semibold text-tv-text-faint">{t("ops.money.noFigures")}</p> : null}
      {lines.map((l) => (
        <dl key={l.currency} className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12px] font-bold text-[#557d78]">
          {rows(l).map(([label, amount]) => (
            <Row key={label} label={label}>
              {fmtMoney(amount, l.currency)}
            </Row>
          ))}
          <Row label={t("ops.money.profit")} tone={profitTone(l.profit)}>
            {fmtMoney(l.profit, l.currency)}
          </Row>
          <Row label={t("ops.money.margin")} tone={profitTone(l.profit)}>
            {marginText(l.margin)}
          </Row>
        </dl>
      ))}
    </div>
  );
}

function Row({ label, tone = "text-[#0f3d38]", children }: { label: string; tone?: string; children: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={`tv-tnum text-end font-extrabold ${tone}`}>
        <DirText dir="ltr">{children}</DirText>
      </dd>
    </>
  );
}
