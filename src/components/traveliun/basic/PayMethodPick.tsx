"use client";

import { DirText } from "@/components/DirText";
import { PAY_METHODS, quoteMethod, type PaymentFees, type PayMethod } from "@/lib/payments/methods";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «طريقة دفع العميل» (the owner, 2026-10-29): how this client will pay — one row of chips, and under it,
 * for the chosen way only and for the staff only, its charge and what is left to us. The chosen way's
 * total is the price the file issues at (issue-pricing.ts) and the total bar below shows it; the client
 * never sees the charge. Every way's total stays one press away («قارن كل الطرق»).
 */
export function PayMethodPick({
  price,
  method,
  fees,
  onPick,
}: {
  /** our price in SAR before any charge */
  price: number;
  method: PayMethod | undefined;
  fees: PaymentFees;
  onPick: (method: PayMethod | undefined) => void;
}) {
  const { t } = useTraveliunUI();
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const chip = (on: boolean) =>
    `h-8 shrink-0 rounded-full border px-3 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-[#185045] bg-[#185045] text-white" : "border-[#cfe0d9] bg-white text-[#185045] hover:bg-[#f4f8f6]"}`;
  const chosen = method ? quoteMethod(price, method, fees) : null;
  return (
    <div className="rounded-[11px] border border-[#d8e6e0] bg-[#f8fbf9] px-3 py-2">
      {/* one row: on a phone it scrolls sideways rather than stacking four rows of chips */}
      <div role="radiogroup" aria-label={t("pg.payMethod.title")} className="flex flex-wrap items-center gap-1.5">
        <span className="me-1 text-[12.5px] font-extrabold text-[#0f3d38]">{t("pg.payMethod.title")}</span>
        <div className="flex gap-1.5 max-sm:-mx-3 max-sm:w-[calc(100%+1.5rem)] max-sm:overflow-x-auto max-sm:px-3 max-sm:pb-0.5 sm:flex-wrap">
        <button type="button" role="radio" aria-checked={!method} onClick={() => onPick(undefined)} className={chip(!method)}>
          {t("pg.payMethod.none")}
        </button>
        {PAY_METHODS.map((m) => {
          const unset = quoteMethod(price, m, fees).unset;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              disabled={unset}
              title={unset ? t("pay.fees.unset") : undefined}
              onClick={() => onPick(m)}
              className={chip(method === m)}
            >
              {t(`pg.payMethod.m.${m}` as TranslationKey)}
            </button>
          );
        })}
        </div>
      </div>
      {chosen && !chosen.unset && chosen.fee > 0 ? (
        <p className="tv-tnum mt-1.5 text-[11px] font-semibold text-[#93aaa3]">{t("pg.payMethod.split", { fee: fmt(chosen.fee), net: fmt(price) })}</p>
      ) : null}
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] font-bold text-[#557d78]">{t("pg.payMethod.compare")}</summary>
        <ul className="tv-tnum mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] font-semibold text-[#557d78]">
          {PAY_METHODS.map((m) => {
            const q = quoteMethod(price, m, fees);
            return (
              <li key={m}>
                {t(`pg.payMethod.m.${m}` as TranslationKey)}: {q.unset ? "—" : <DirText dir="ltr">{`${fmt(q.total)} SAR`}</DirText>}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
