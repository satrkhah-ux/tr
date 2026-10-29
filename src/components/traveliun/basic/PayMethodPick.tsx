"use client";

import { DirText } from "@/components/DirText";
import { PAY_METHODS, quoteMethod, type PaymentFees, type PayMethod } from "@/lib/payments/methods";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «طريقة دفع العميل» (the owner, 2026-10-29): how this client will pay, with what each way makes
 * the client total — and, for the staff only, its charge and what is left to us. The chosen way's
 * total is the price the file issues at (issue-pricing.ts); the client never sees the charge.
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
  return (
    <div className="rounded-[11px] border border-[#d8e6e0] bg-[#f8fbf9] px-3 py-2">
      <p className="text-[12.5px] font-extrabold text-[#0f3d38]">{t("pg.payMethod.title")}</p>
      <p className="mt-0.5 text-[11.5px] font-semibold text-[#557d78]">{t("pg.payMethod.hint")}</p>
      <div role="radiogroup" aria-label={t("pg.payMethod.title")} className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <button
          type="button"
          role="radio"
          aria-checked={!method}
          onClick={() => onPick(undefined)}
          className={`flex items-center justify-between gap-2 rounded-[8px] border px-2.5 py-1.5 text-start text-[12px] font-bold ${!method ? "border-[#185045] bg-[#e9f4ef] text-[#0f3d38]" : "border-[#dbe6e1] bg-white text-[#557d78]"}`}
        >
          {t("pg.payMethod.none")}
          <span className="tv-tnum font-extrabold">
            <DirText dir="ltr">{`${fmt(price)} SAR`}</DirText>
          </span>
        </button>
        {PAY_METHODS.map((m) => {
          const q = quoteMethod(price, m, fees);
          const on = method === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={q.unset}
              title={q.unset ? t("pay.fees.unset") : undefined}
              onClick={() => onPick(m)}
              className={`grid gap-0.5 rounded-[8px] border px-2.5 py-1.5 text-start text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-[#185045] bg-[#e9f4ef] text-[#0f3d38]" : "border-[#dbe6e1] bg-white text-[#557d78]"}`}
            >
              <span className="flex items-center justify-between gap-2">
                {t(`pay.method.${m}` as TranslationKey)}
                <span className="tv-tnum font-extrabold">{q.unset ? "—" : <DirText dir="ltr">{`${fmt(q.total)} SAR`}</DirText>}</span>
              </span>
              {!q.unset && q.fee > 0 ? (
                <span className="tv-tnum text-[10.5px] font-semibold text-[#93aaa3]">{t("pg.payMethod.split", { fee: fmt(q.fee), net: fmt(price) })}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
