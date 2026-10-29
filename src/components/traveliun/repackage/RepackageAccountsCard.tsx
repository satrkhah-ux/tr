"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { DirText } from "@/components/DirText";
import { getRepackageAccounts, type RepackageAccountsView } from "@/lib/data/repackage-order";
import type { Money } from "@/lib/operations/money";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { fmtMoney, marginText, profitTone } from "../operations/CaseProfitCard";
import { sectionClass } from "./stage-props";

const amountIn = (list: Money[], currency: string) => list.find((m) => m.currency === currency)?.amount ?? 0;

/**
 * «الحسابات» of a repackaged file — what the client pays, has paid and still owes;
 * what the supplier costs us, what we paid it and still owe it; and the profit.
 * The figures are the case's own (the same ones «ربحية الحالة» shows): before the
 * case exists they are the file's prices; after, payments and the supplier's
 * package line are in. Internal — the server returns nothing without
 * pricing.internal, and this renders nothing then.
 */
export function RepackageAccountsCard({ draftId, refreshKey = 0 }: { draftId: string; refreshKey?: number }) {
  const { t } = useTraveliunUI();
  const [view, setView] = useState<RepackageAccountsView | null>(null);

  useEffect(() => {
    let alive = true;
    void getRepackageAccounts(draftId).then((v) => {
      if (alive) setView(v);
    });
    return () => {
      alive = false;
    };
  }, [draftId, refreshKey]);

  if (!view) return null;
  // one block per currency: a margin in riyals and one in dollars are two margins (operations/money.ts)
  const lines = view.expected.length > 0 ? view.expected : [];
  const currency = view.sale?.currency ?? lines[0]?.currency ?? "SAR";
  return (
    <section className={sectionClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-extrabold text-[#0f3d38]">
          <Wallet className="size-4 text-[#185045]" />
          {t("rp.acc.title")}
          <span className="rounded-full bg-[#fff8e8] px-2 py-0.5 text-[10.5px] font-bold text-[#a86a10]">{t("ops.money.internal")}</span>
        </h3>
        {view.hasCase && view.operationId ? (
          <Link href={`/operations/${view.operationId}`} className="text-[12px] font-bold text-[#2aa87a] hover:underline">
            {t("rp.acc.openCase")}
          </Link>
        ) : null}
      </div>
      <p className="mb-3 mt-1 text-[11.5px] font-semibold text-[#93aaa3]">{view.hasCase ? t("ops.money.caseHint") : t("rp.acc.noCase")}</p>

      <div className="grid gap-3 md:grid-cols-2">
        {lines.length === 0 ? <p className="text-[12px] font-semibold text-[#93aaa3]">{t("ops.money.noFigures")}</p> : null}
        {lines.map((l) => (
          <div key={l.currency} className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
            <p className="text-[11.5px] font-bold text-[#93aaa3]">{t("ops.money.expected")} · {l.currency}</p>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12px] font-bold text-[#557d78]">
              <Row label={t("ops.money.sale")}>{fmtMoney(l.revenue, l.currency)}</Row>
              <Row label={t("ops.money.cost")}>{fmtMoney(l.cost, l.currency)}</Row>
              <Row label={t("ops.money.profit")} tone={profitTone(l.profit)}>{fmtMoney(l.profit, l.currency)}</Row>
              <Row label={t("ops.money.margin")} tone={profitTone(l.profit)}>{marginText(l.margin)}</Row>
            </dl>
          </div>
        ))}

        <div className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
          <p className="text-[11.5px] font-bold text-[#93aaa3]">{t("ops.money.actual")}</p>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12px] font-bold text-[#557d78]">
            <Row label={t("ops.money.received")}>{fmtMoney(view.paid, currency)}</Row>
            <Row label={t("rp.acc.remaining")} tone={view.remaining != null && view.remaining > 0 ? "text-[#a86a10]" : undefined}>
              {view.remaining == null ? "—" : fmtMoney(view.remaining, currency)}
            </Row>
            {view.actual.map((l) => (
              <Row key={`s${l.currency}`} label={`${t("ops.money.supplierPaid")} · ${l.currency}`}>{fmtMoney(amountIn(view.supplierPaid, l.currency), l.currency)}</Row>
            ))}
            {view.actual.map((l) => (
              <Row key={`o${l.currency}`} label={`${t("ops.money.supplierOwed")} · ${l.currency}`}>{fmtMoney(amountIn(view.supplierOwed, l.currency), l.currency)}</Row>
            ))}
          </dl>
        </div>
      </div>
    </section>
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
