"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { setPaymentFees, setSettlementRule } from "@/lib/data/app-settings";
import { PAY_METHODS, type MethodFee, type PayMethod, type PaymentFees, type SettlementRule } from "@/lib/payments/methods";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "./TraveliunUIProvider";

const field = "tv-field h-9 w-20 rounded-[9px] border px-2 text-center text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus";

/**
 * «رسوم وسائل الدفع» on «سياسة الربح» (the owner, 2026-10-29): per method a
 * share and a fixed charge — what the calculator, the payment step, the price
 * update and the PDF all add (lib/payments/methods.ts). An empty share means
 * «غير محددة»: that method is shown without a price until it is set.
 */
export function PaymentFeesAdmin({ initial, settlement }: { initial: PaymentFees; settlement: SettlementRule }) {
  const { t } = useTraveliunUI();
  const toText = (f: MethodFee) => ({ pct: f ? String(f.pct) : "", fixed: f && f.fixed ? String(f.fixed) : "" });
  const [rows, setRows] = useState<Record<PayMethod, { pct: string; fixed: string }>>(
    () => Object.fromEntries(PAY_METHODS.map((m) => [m, toText(initial[m])])) as Record<PayMethod, { pct: string; fixed: string }>,
  );
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [rule, setRule] = useState(settlement);

  async function save() {
    const next = Object.fromEntries(
      PAY_METHODS.map((m) => {
        const pct = rows[m].pct.trim();
        return [m, pct === "" ? null : { pct: Number(pct), fixed: rows[m].fixed.trim() === "" ? 0 : Number(rows[m].fixed) }];
      }),
    ) as PaymentFees;
    setState("saving");
    const [res, ruleRes] = await Promise.all([setPaymentFees(next), setSettlementRule(rule)]);
    setState(res.ok && ruleRes.ok ? "saved" : "error");
  }

  return (
    <section className="mt-4 max-w-3xl rounded-[14px] border border-[#cfe0d9] bg-white p-4">
      <h2 className="text-[14px] font-extrabold text-[#185045]">{t("pay.fees.title")}</h2>
      <p className="mt-1 mb-3 text-[12px] font-semibold text-tv-text-faint">{t("pay.fees.hint")}</p>
      <div className="grid gap-1.5">
        {PAY_METHODS.map((m) => (
          <div key={m} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#eef2f0] px-3 py-2">
            <span className="min-w-36 flex-1 text-[13px] font-extrabold text-[#0f3d38]">{t(`pay.method.${m}` as TranslationKey)}</span>
            <label className="flex items-center gap-1.5 text-[12px] font-bold text-[#557d78]">
              <input
                type="number"
                min={0}
                max={30}
                step="0.001"
                dir="ltr"
                value={rows[m].pct}
                placeholder="—"
                aria-label={`${t(`pay.method.${m}` as TranslationKey)} %`}
                onChange={(e) => setRows((r) => ({ ...r, [m]: { ...r[m], pct: e.target.value } }))}
                className={field}
              />
              %
            </label>
            <label className="flex items-center gap-1.5 text-[12px] font-bold text-[#557d78]">
              +
              <input
                type="number"
                min={0}
                max={1000}
                step="0.01"
                dir="ltr"
                value={rows[m].fixed}
                placeholder="0"
                aria-label={`${t(`pay.method.${m}` as TranslationKey)} ${t("pay.fees.fixed")}`}
                onChange={(e) => setRows((r) => ({ ...r, [m]: { ...r[m], fixed: e.target.value } }))}
                className={field}
              />
              {t("pay.fees.fixed")}
            </label>
            {rows[m].pct.trim() === "" ? <span className="text-[11px] font-bold text-[#a86a10]">{t("pay.fees.unset")}</span> : null}
          </div>
        ))}
      </div>
      <h3 className="mt-4 text-[13px] font-extrabold text-[#185045]">{t("pay.settle.title")}</h3>
      <p className="mt-1 mb-2 text-[12px] font-semibold text-tv-text-faint">{t("pay.settle.hint")}</p>
      <div className="flex flex-wrap items-center gap-3 text-[12px] font-bold text-[#557d78]">
        <label className="flex items-center gap-1.5">
          {t("pay.settle.weekday")}
          <select value={rule.weekday} onChange={(e) => setRule((r) => ({ ...r, weekday: Number(e.target.value) }))} className={`${field} w-28`}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>
                {t(`pay.settle.day${d}` as TranslationKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={8}
            step={1}
            dir="ltr"
            value={rule.lagWeeks}
            onChange={(e) => setRule((r) => ({ ...r, lagWeeks: Math.max(0, Math.min(8, Math.trunc(Number(e.target.value) || 0))) }))}
            className={field}
          />
          {t("pay.settle.lag")}
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={state === "saving"}
          onClick={() => void save()}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
        >
          {state === "saving" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {t("save")}
        </button>
        {state === "saved" ? <span className="text-[12px] font-bold text-[#1d7a4f]">{t("pay.fees.saved")}</span> : null}
        {state === "error" ? <span className="text-[12px] font-bold text-[#c22850]">{t("pay.fees.error")}</span> : null}
      </div>
    </section>
  );
}
