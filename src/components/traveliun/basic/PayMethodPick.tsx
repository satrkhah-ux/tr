"use client";

import { DirText } from "@/components/DirText";
import { PAY_METHODS, quoteMethod, type PaymentFees, type PayMethod } from "@/lib/payments/methods";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * The providers' own marks, as their merchant kits give them (public/images/payments — only the empty
 * margin trimmed): Tabby's badge (its primary black-on-green), Tamara's wordmark, mada's dual-language
 * logo — each with the kit's own version for a dark background. mada's rules: never under 60px wide,
 * never smaller than the marks beside it, never in a white box on a coloured ground.
 */
const LOGO: Partial<Record<PayMethod, { light: string; dark: string; size: string; darkSize: string }>> = {
  tabby: { light: "/images/payments/tabby.svg", dark: "/images/payments/tabby.svg", size: "h-6", darkSize: "h-6" },
  tamara: { light: "/images/payments/tamara.svg", dark: "/images/payments/tamara-white.svg", size: "h-4", darkSize: "h-4" },
  pos: { light: "/images/payments/mada.svg", dark: "/images/payments/mada-dark.png", size: "h-6", darkSize: "h-8" },
};

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
    // chosen = a light tint and a dark ring, never a dark fill: the marks keep the ground their kits ask for
    `inline-flex h-9 shrink-0 items-center rounded-full border px-3 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-[#185045] bg-[#e9f4ef] text-[#0f3d38] ring-1 ring-[#185045] dark:border-[#91decf] dark:bg-[#12352c] dark:text-[#e7f0ec] dark:ring-[#91decf]" : "border-[#cfe0d9] bg-white text-[#185045] hover:bg-[#f4f8f6]"}`;
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
          const name = t(`pg.payMethod.m.${m}` as TranslationKey);
          const logo = LOGO[m];
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
              {logo ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the providers' small files, shown as they are */}
                  <img src={logo.light} alt={name} className={`${logo.size} w-auto dark:hidden`} />
                  {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                  <img src={logo.dark} alt={name} className={`hidden ${logo.darkSize} w-auto dark:block`} />
                </>
              ) : (
                name
              )}
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
