"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import type { AgreementContext } from "@/lib/data/payment-agreement";
import { clientAmount, lastPayDay, splitEqual, spreadDates, validateAgreement, type Agreement, type AgreementRow } from "@/lib/operations/agreement";
import { isBnpl, PAY_METHODS, type PayMethod } from "@/lib/payments/methods";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useBasicLabels, type BasicLabel } from "./labels";

type Mode = "single" | "plan" | "later";
type Draft = { due_date: string; amount: string; method: PayMethod | "" };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const field =
  "h-11 w-full rounded-[10px] border border-[#cfe0d9] bg-white px-2.5 text-[14px] font-bold text-[#0f3d38] outline-none focus:border-[#185045] dark:bg-[#14231f] dark:text-[#eaf3ef]";

/**
 * «كيف تم الاتفاق المالي؟» (the owner, 2026-10-30) — the step after «كيف أكّد
 * العميل؟»: one payment (a date and a way), installments (date, amount and way
 * per row, with 50/50 and three-equal helpers, the remainder shown), or «لاحقاً»
 * so a confirmation is never held up. Amounts are OUR price; under each row,
 * what the client pays by its way — the total only, never a fee or a %. Staff
 * only: this screen is never shown to a client.
 */
export function PaymentAgreementDialog({
  open,
  context,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  open: boolean;
  /** undefined while loading, null when it could not be read */
  context: AgreementContext | null | undefined;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (agreement: Agreement) => void;
}) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const [mode, setMode] = useState<Mode>("single");
  const [single, setSingle] = useState<{ due_date: string; method: PayMethod | "" } | null>(null);
  const [rows, setRows] = useState<Draft[] | null>(null);

  const ctx = context ?? null;
  const today = ctx?.today ?? "";
  const last = ctx ? lastPayDay(ctx.travelStart) : null;
  const one = single ?? { due_date: today, method: ctx?.method ?? "" };
  const plan = rows ?? (ctx ? halves(ctx.base, today, last, "") : []);
  const methodName = (m: PayMethod) => t(`pg.payMethod.m.${m}` as TranslationKey);

  const agreementRows: AgreementRow[] =
    mode === "single" && ctx
      ? [{ due_date: one.due_date, amount: ctx.base, method: one.method || null }]
      : plan.map((r) => ({ due_date: r.due_date, amount: Number(r.amount), method: r.method || null }));
  const invalid = mode === "later" || !ctx ? null : validateAgreement(agreementRows, ctx);
  const sum = plan.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const left = ctx ? Math.round((ctx.base - sum) * 100) / 100 : 0;

  const setRow = (i: number, patch: Partial<Draft>) => setRows(plan.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pays = (amount: number, method: PayMethod | "") => {
    const paid = clientAmount(amount, method || null, ctx?.fees ?? null);
    return Math.abs(paid - amount) > 0.005 ? paid : null;
  };

  const submit = () => {
    if (mode === "later") return onSubmit({ kind: "later" });
    if (!ctx || invalid) return;
    onSubmit({ kind: mode, rows: agreementRows });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !busy ? onBack() : undefined)}>
      <DialogContent className="p-4 sm:p-5" showClose={false}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <DialogTitle className="text-[16px]">{tx("agreeTitle")}</DialogTitle>
          <button type="button" aria-label={tx("closeLabel")} disabled={busy} onClick={onBack} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0]">
            <X className="size-4" />
          </button>
        </div>

        <div role="radiogroup" aria-label={tx("agreeTitle")} className="grid grid-cols-3 gap-1.5">
          {(["single", "plan", "later"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`h-11 rounded-[10px] border text-[13px] font-extrabold ${mode === m ? "border-[#185045] bg-[#e9f4ef] text-[#0f3d38] ring-1 ring-[#185045]" : "border-[#cfe0d9] bg-white text-[#185045]"}`}
            >
              {tx(m === "single" ? "agreeOnce" : m === "plan" ? "agreePlan" : "agreeLater")}
            </button>
          ))}
        </div>

        {mode === "later" ? (
          <p className="mt-3 rounded-[10px] bg-[#fff8e8] px-3 py-2 text-[12.5px] font-bold text-[#8a5a0c]">{tx("agreeLaterHint")}</p>
        ) : context === undefined ? (
          <p className="mt-3 flex items-center gap-1.5 text-[12.5px] font-semibold text-[#557d78]">
            <Loader2 className="size-4 animate-spin" /> {tx("agreeLoading")}
          </p>
        ) : !ctx ? (
          <p className="mt-3 text-[12.5px] font-bold text-[#c22850]">{tx("agreeNoContext")}</p>
        ) : (
          <div className="mt-3 space-y-2.5">
            <p className="tv-tnum flex flex-wrap justify-between gap-x-3 text-[12.5px] font-extrabold text-[#0f3d38]">
              <DirText>{tx("agreeTotal", { total: `${fmt(ctx.base)} ${ctx.currency}` })}</DirText>
              {last ? <span className="font-semibold text-[#557d78]">{tx("agreeLastDay", { d: last })}</span> : null}
            </p>

            {mode === "single" ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
                  {tx("agreeDate")}
                  <input type="date" dir="ltr" min={today} max={last ?? undefined} value={one.due_date} onChange={(e) => setSingle({ ...one, due_date: e.target.value })} className={`${field} tv-tnum`} />
                </label>
                <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
                  {tx("agreeMethod")}
                  <select value={one.method} onChange={(e) => setSingle({ ...one, method: e.target.value as PayMethod | "" })} className={field}>
                    <option value="">{tx("agreeNoMethod")}</option>
                    {PAY_METHODS.map((m) => {
                      const p = pays(ctx.base, m);
                      return (
                        <option key={m} value={m}>
                          {p ? `${methodName(m)} — ${fmt(p)}` : methodName(m)}
                        </option>
                      );
                    })}
                  </select>
                </label>
                {one.method && pays(ctx.base, one.method) ? (
                  <p className="tv-tnum col-span-2 text-[12px] font-extrabold text-[#0f7a52]">
                    {tx("agreeClientPays")}: <DirText dir="ltr">{`${fmt(pays(ctx.base, one.method) ?? 0)} ${ctx.currency}`}</DirText>
                  </p>
                ) : null}
                {one.method && isBnpl(one.method) ? <p className="col-span-2 text-[11.5px] font-semibold text-[#557d78]">{tx("agreeBnplNote")}</p> : null}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setRows(halves(ctx.base, today, last, plan[0]?.method ?? ""))} className={chip}>
                    {tx("agreeHalf")}
                  </button>
                  <button type="button" onClick={() => setRows(equal(ctx.base, today, last, 3, plan[0]?.method ?? ""))} className={chip}>
                    {tx("agreeThree")}
                  </button>
                </div>
                {plan.map((r, i) => {
                  const p = pays(Number(r.amount) || 0, r.method);
                  return (
                    <div key={i} className="rounded-[10px] border border-[#e1ebe6] p-2">
                      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-1.5">
                        <label className="grid gap-1 text-[11px] font-bold text-[#557d78]">
                          {tx("agreeDate")}
                          <input type="date" dir="ltr" min={today} max={last ?? undefined} value={r.due_date} onChange={(e) => setRow(i, { due_date: e.target.value })} className={`${field} tv-tnum px-1.5 text-[13px]`} />
                        </label>
                        <label className="grid gap-1 text-[11px] font-bold text-[#557d78]">
                          {tx("agreeAmount")}
                          <input type="number" inputMode="decimal" min={0} step="0.01" dir="ltr" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} className={`${field} tv-tnum text-center`} />
                        </label>
                        <button
                          type="button"
                          aria-label={tx("closeLabel")}
                          disabled={plan.length <= 1}
                          onClick={() => setRows(plan.filter((_, j) => j !== i))}
                          className="inline-flex size-11 items-center justify-center rounded-[10px] border border-[#f2c7c7] text-[#c43d3d] disabled:opacity-40"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <select aria-label={tx("agreeMethod")} value={r.method} onChange={(e) => setRow(i, { method: e.target.value as PayMethod | "" })} className={`${field} h-10 flex-1 text-[13px]`}>
                          <option value="">{tx("agreeMethod")}: {tx("agreeNoMethod")}</option>
                          {/* Tabby / Tamara are one full payment — «دفعة واحدة» */}
                          {PAY_METHODS.filter((m) => !isBnpl(m)).map((m) => (
                            <option key={m} value={m}>
                              {methodName(m)}
                            </option>
                          ))}
                        </select>
                        {p ? (
                          <span className="tv-tnum shrink-0 text-[11.5px] font-extrabold text-[#0f7a52]">
                            {tx("agreeClientPays")} <DirText dir="ltr">{fmt(p)}</DirText>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => setRows([...plan, { due_date: "", amount: left > 0 ? String(left) : "", method: plan[plan.length - 1]?.method ?? "" }])} className={chip}>
                    <Plus className="size-3.5" />
                    {tx("agreeAddRow")}
                  </button>
                  <span className={`tv-tnum text-[12px] font-extrabold ${Math.abs(left) < 0.005 ? "text-[#0f7a52]" : "text-[#a86a10]"}`}>
                    <DirText>{left >= 0 ? tx("agreeRemaining", { n: fmt(left) }) : tx("agreeOver", { n: fmt(-left) })}</DirText>
                  </span>
                </div>
              </>
            )}
            {invalid ? <p className="text-[12px] font-bold text-[#a86a10]">{tx(`agree_${invalid}` as BasicLabel)}</p> : null}
          </div>
        )}

        {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || (mode !== "later" && (!ctx || invalid !== null))}
            onClick={submit}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-[#0f7a52] text-[14px] font-extrabold text-white hover:bg-[#0b6140] disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {tx("agreeConfirm")}
          </button>
          <button type="button" disabled={busy} onClick={onBack} className="h-11 rounded-[10px] border border-[#cfe0d9] px-4 text-[13px] font-bold text-[#185045]">
            {tx("agreeBack")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const chip = "inline-flex h-9 items-center gap-1 rounded-full border border-[#cfe0d9] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6]";

function equal(total: number, today: string, last: string | null, n: number, method: PayMethod | ""): Draft[] {
  const dates = spreadDates(today, last, n);
  return splitEqual(total, n).map((amount, i) => ({ due_date: dates[i], amount: String(amount), method }));
}
const halves = (total: number, today: string, last: string | null, method: PayMethod | "") => equal(total, today, last, 2, method);
