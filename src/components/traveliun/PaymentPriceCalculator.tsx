"use client";

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { DirText } from "@/components/DirText";
import { getPaymentFees } from "@/lib/data/app-settings";
import { DEFAULT_FEES, quoteAll, type PaymentFees } from "@/lib/payments/methods";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * «التسعير النهائي بوسائل الدفع» (the owner, 2026-10-29): one price in, what
 * the client pays by each method out — the administration's fees from
 * «سياسة الربح» (lib/payments/methods.ts). Sits under the currency converter
 * in the header's calculator.
 */
export function PaymentPriceCalculator() {
  const { t } = useTraveliunUI();
  const [fees, setFees] = useState<PaymentFees>(DEFAULT_FEES);
  const [base, setBase] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let live = true;
    getPaymentFees()
      .then((f) => live && setFees(f))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const price = Number(base);
  const quotes = Number.isFinite(price) && price > 0 ? quoteAll(price, fees) : [];
  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <div className="mt-4 border-t border-[#e4ece8] pt-3">
      <h3 className="mb-2 text-sm font-bold text-[var(--tv-brand)]">{t("pay.calc.title")}</h3>
      <input
        type="number"
        min={0}
        dir="ltr"
        value={base}
        onChange={(e) => setBase(e.target.value)}
        placeholder={t("pay.calc.base")}
        aria-label={t("pay.calc.base")}
        className="tv-tnum h-10 w-full rounded-md border border-[#ddd4d3] px-3 text-start text-sm outline-none focus:border-[var(--tv-brand)]"
      />
      {quotes.length > 0 ? (
        <ul className="mt-2 grid gap-1">
          {quotes.map((q) => (
            <li key={q.method} className="flex items-center gap-2 rounded-md bg-[#f4f8f6] px-2.5 py-1.5 text-[12.5px]">
              <span className="min-w-0 flex-1 font-bold text-[#185045]">{t(`pay.method.${q.method}` as TranslationKey)}</span>
              {q.unset ? (
                <span className="text-[11px] font-bold text-[#a86a10]">{t("pay.fees.unset")}</span>
              ) : (
                <>
                  {q.fee > 0 ? <span className="tv-tnum text-[11px] font-semibold text-[#93aaa3]">+{fmt(q.fee)}</span> : null}
                  <span className="tv-tnum font-extrabold text-[#0f3d38]">
                    <DirText dir="ltr">{`${fmt(q.total)} SAR`}</DirText>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(String(q.total));
                      setCopied(q.method);
                      window.setTimeout(() => setCopied(""), 1400);
                    }}
                    aria-label={t("copy")}
                    className="rounded p-1 text-[#6f8f88] hover:bg-white hover:text-[var(--tv-brand)]"
                  >
                    {copied === q.method ? <span className="text-[10px] font-bold">✓</span> : <Copy className="size-3.5" />}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
