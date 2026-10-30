"use client";

import type { ReactNode } from "react";
import { Banknote, Landmark } from "lucide-react";
import { DirText } from "@/components/DirText";
import { PAY_METHODS, quoteMethod, type PaymentFees, type PayMethod } from "@/lib/payments/methods";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * The providers' own marks, as their merchant kits give them (public/images/payments — only the empty
 * margin trimmed): Tabby's badge (its primary black-on-green), Tamara's wordmark, mada's dual-language
 * logo — each with the kit's own version for a dark background. mada's rules: never under 60px wide,
 * never smaller than the marks beside it, never in a white box on a coloured ground.
 *
 * The list of the files there is: a way without one (MyFatoorah) stays a word until its official file
 * is dropped in public/images/payments and named here — PayMethodPick.test.ts fails on a file the list
 * does not name, or a name with no file (so no image ever answers 404).
 */
export const PAY_LOGOS: Partial<Record<PayMethod, { light: string; dark: string; size: string; darkSize: string }>> = {
  tabby: { light: "/images/payments/tabby.svg", dark: "/images/payments/tabby.svg", size: "h-4", darkSize: "h-4" },
  tamara: { light: "/images/payments/tamara.svg", dark: "/images/payments/tamara-white.svg", size: "h-4", darkSize: "h-4" },
  pos: { light: "/images/payments/mada.svg", dark: "/images/payments/mada-dark.png", size: "h-[22px]", darkSize: "h-8" },
  // MyFatoorah's own logo from myfatoorah.com (MF-Logo-White); the light-mode copy only turns its white letters dark
  link: { light: "/images/payments/myfatoorah.png", dark: "/images/payments/myfatoorah-white.png", size: "h-3.5", darkSize: "h-3.5" },
};

/**
 * Visa's and Mastercard's acceptance marks — the path data of the simple-icons project (CC0), in their
 * colours (Visa's navy turns white on a dark ground, as Visa's own reversed mark), cut to the mark.
 */
function CardMarks() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      <svg viewBox="0 8.1 24 7.8" className="h-3 w-auto fill-[#1A1F71] dark:fill-white">
        <path d="M9.112 8.262L5.97 15.758H3.92L2.374 9.775c-.094-.368-.175-.503-.461-.658C1.447 8.864.677 8.627 0 8.479l.046-.217h3.3a.904.904 0 01.894.764l.817 4.338 2.018-5.102zm8.033 5.049c.008-1.979-2.736-2.088-2.717-2.972.006-.269.262-.555.822-.628a3.66 3.66 0 011.913.336l.34-1.59a5.207 5.207 0 00-1.814-.333c-1.917 0-3.266 1.02-3.278 2.479-.012 1.079.963 1.68 1.698 2.04.756.367 1.01.603 1.006.931-.005.504-.602.725-1.16.734-.975.015-1.54-.263-1.992-.473l-.351 1.642c.453.208 1.289.39 2.156.398 2.037 0 3.37-1.006 3.377-2.564m5.061 2.447H24l-1.565-7.496h-1.656a.883.883 0 00-.826.55l-2.909 6.946h2.036l.405-1.12h2.488zm-2.163-2.656l1.02-2.815.588 2.815zm-8.16-4.84l-1.603 7.496H8.34l1.605-7.496z" />
      </svg>
      <svg viewBox="0 4.6 24 14.8" className="h-4 w-auto fill-[#EB001B]">
        <path d="M11.343 18.031c.058.049.12.098.181.146-1.177.783-2.59 1.238-4.107 1.238C3.32 19.416 0 16.096 0 12c0-4.095 3.32-7.416 7.416-7.416 1.518 0 2.931.456 4.105 1.238-.06.051-.12.098-.165.15C9.6 7.489 8.595 9.688 8.595 12c0 2.311 1.001 4.51 2.748 6.031zm5.241-13.447c-1.52 0-2.931.456-4.105 1.238.06.051.12.098.165.15C14.4 7.489 15.405 9.688 15.405 12c0 2.31-1.001 4.507-2.748 6.031-.058.049-.12.098-.181.146 1.177.783 2.588 1.238 4.107 1.238C20.68 19.416 24 16.096 24 12c0-4.094-3.32-7.416-7.416-7.416zM12 6.174c-.096.075-.189.15-.28.231C10.156 7.764 9.169 9.765 9.169 12c0 2.236.987 4.236 2.551 5.595.09.08.185.158.28.232.096-.074.189-.152.28-.232 1.563-1.359 2.551-3.359 2.551-5.595 0-2.235-.987-4.236-2.551-5.595-.09-.08-.184-.156-.28-.231z" />
      </svg>
    </span>
  );
}

/** The ways with no brand of their own: a plain mark beside the word. */
const WORD_MARK: Partial<Record<PayMethod, ReactNode>> = {
  card: <CardMarks />,
  cash: <Banknote className="size-4" aria-hidden />,
  transfer: <Landmark className="size-4" aria-hidden />,
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
    `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-[#185045] bg-[#e9f4ef] text-[#0f3d38] ring-1 ring-[#185045] dark:border-[#91decf] dark:bg-[#12352c] dark:text-[#e7f0ec] dark:ring-[#91decf]" : "border-[#cfe0d9] bg-white text-[#185045] hover:bg-[#f4f8f6]"}`;
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
          const logo = PAY_LOGOS[m];
          const mark = WORD_MARK[m];
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
                <>
                  {mark}
                  {name}
                </>
              )}
            </button>
          );
        })}
        </div>
      </div>
      {chosen && !chosen.unset && chosen.fee > 0 ? (
        <p className="tv-tnum mt-1.5 text-[11px] font-semibold text-tv-text-faint">{t("pg.payMethod.split", { fee: fmt(chosen.fee), net: fmt(price) })}</p>
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
