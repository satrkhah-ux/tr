"use client";

import { useState } from "react";
import { Plus, Wand2, X } from "lucide-react";
import { planGap, splitDues, suggestDeposit, type PaymentPlan } from "@/lib/offer/payment-plan";
import { basicField, typedNumber } from "./styles";

/**
 * «خطة الدفع» in Basic's pricing (the owner, 2026-10-31): the first payment that holds the booking (suggested from
 * the profit, rounded up to the next 500 — the employee changes it, writes a note, says if it is refundable), then
 * the rest split over the hotels' refund deadlines; every payment editable, and the sum checked against the total.
 * The client's file prints amounts and dates only (payment-plan.ts planLines).
 */
export function PaymentPlanBox({
  plan,
  total,
  profit,
  currency,
  dates,
  onChange,
}: {
  plan: PaymentPlan | undefined;
  /** what the client pays */
  total: number;
  profit: number;
  currency: string;
  /** the hotels' refund / pay-by deadlines still ahead, earliest first (dueDates) */
  dates: string[];
  onChange: (plan: PaymentPlan | undefined) => void;
}) {
  const [count, setCount] = useState(Math.max(1, dates.length));
  const cur = currency === "SAR" ? "ريال" : currency;
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

  if (!plan) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-[11px] border border-dashed border-[#cfe0d9] px-3 py-2">
        <span className="text-[12.5px] font-extrabold text-[#0f3d38]">خطة الدفع</span>
        <button
          type="button"
          onClick={() => {
            const deposit = Math.min(suggestDeposit(profit), total);
            onChange({ deposit: { amount: deposit, refundable: false, note: "" }, payments: splitDues(total, deposit, dates, Math.max(1, dates.length)) });
          }}
          className="inline-flex h-8 max-sm:h-10 items-center gap-1 rounded-[8px] border border-[#cfe0d9] bg-white px-3 text-[12px] font-bold text-[#185045]"
        >
          <Plus className="size-3.5" />
          الدفعة الأولى لتثبيت الحجز والمستحقات
        </button>
        <span className="text-[11px] font-semibold text-tv-text-faint">اختيارية — تظهر للعميل تحت «الشروط المالية».</span>
      </div>
    );
  }

  const gap = planGap(total, plan);
  const deposit = plan.deposit?.amount ?? 0;
  const setPayment = (i: number, next: Partial<PaymentPlan["payments"][number]>) =>
    onChange({ ...plan, payments: plan.payments.map((p, j) => (j === i ? { ...p, ...next } : p)) });

  return (
    <div className="space-y-2 rounded-[11px] border border-[#d8e6e0] bg-[#f8fbf9] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-extrabold text-[#0f3d38]">خطة الدفع</span>
        <button type="button" onClick={() => onChange(undefined)} className="text-[11.5px] font-bold text-[#c43d3d] underline">
          احذف الخطة
        </button>
      </div>

      {plan.deposit ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-bold text-[#185045]">الدفعة الأولى لتثبيت الحجز</span>
          <input
            type="number" inputMode="decimal" min={0} dir="ltr" aria-label="الدفعة الأولى"
            value={plan.deposit.amount}
            onChange={(e) => onChange({ ...plan, deposit: { ...plan.deposit!, amount: typedNumber(e.target) ?? 0 } })}
            className={`${basicField} tv-tnum w-28 text-center`}
          />
          <span className="text-[11.5px] font-bold text-[#557d78]">{cur}</span>
          <span role="radiogroup" className="inline-flex rounded-[8px] border border-[#cfe0d9] bg-white p-0.5">
            {([false, true] as const).map((r) => (
              <button
                key={String(r)} type="button" role="radio" aria-checked={plan.deposit!.refundable === r}
                onClick={() => onChange({ ...plan, deposit: { ...plan.deposit!, refundable: r } })}
                className={`h-7 rounded-[6px] px-2.5 text-[11.5px] font-bold ${plan.deposit!.refundable === r ? "bg-[#185045] text-white" : "text-[#557d78]"}`}
              >
                {r ? "مسترجعة" : "غير مسترجعة"}
              </button>
            ))}
          </span>
          <input
            value={plan.deposit.note} maxLength={200} placeholder="ملاحظة تظهر للعميل (اختيارية)"
            onChange={(e) => onChange({ ...plan, deposit: { ...plan.deposit!, note: e.target.value } })}
            className={`${basicField} min-w-[12rem] flex-1`}
          />
          <span className="text-[11px] font-semibold text-tv-text-faint">المقترح: {fmt(suggestDeposit(profit))} {cur}</span>
          <button type="button" aria-label="احذف الدفعة الأولى" onClick={() => onChange({ ...plan, deposit: null })} className="text-[#c43d3d]">
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => onChange({ ...plan, deposit: { amount: Math.min(suggestDeposit(profit), total), refundable: false, note: "" } })} className="inline-flex items-center gap-1 text-[12px] font-bold text-[#185045] underline">
          <Plus className="size-3.5" />
          أضف الدفعة الأولى لتثبيت الحجز
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-bold text-[#185045]">قسّط الباقي ({fmt(Math.max(0, total - deposit))} {cur}) على</span>
        <input
          type="number" inputMode="numeric" min={1} max={24} dir="ltr" aria-label="عدد الدفعات"
          value={count} onChange={(e) => setCount(Math.max(1, Math.min(24, typedNumber(e.target) ?? 1)))}
          className={`${basicField} tv-tnum w-16 text-center`}
        />
        <span className="text-[12px] font-bold text-[#185045]">دفعات</span>
        <button type="button" onClick={() => onChange({ ...plan, payments: splitDues(total, deposit, dates, count) })} className="inline-flex h-8 max-sm:h-10 items-center gap-1 rounded-[8px] bg-[#185045] px-3 text-[12px] font-bold text-white">
          <Wand2 className="size-3.5" />
          قسّط
        </button>
        <span className="text-[11px] font-semibold text-tv-text-faint">
          {dates.length ? `تواريخ الاسترجاع في الفنادق: ${dates.join("، ")}` : "لا تواريخ استرجاع في الفنادق — الدفعة بلا تاريخ تُكتب «قبل السفر»."}
        </span>
      </div>

      {plan.payments.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-[12px] font-bold text-[#557d78]">دفعة {i + (plan.deposit ? 2 : 1)}</span>
          <input
            type="number" inputMode="decimal" min={0} dir="ltr" aria-label={`مبلغ الدفعة ${i + 1}`}
            value={p.amount} onChange={(e) => setPayment(i, { amount: typedNumber(e.target) ?? 0 })}
            className={`${basicField} tv-tnum w-28 text-center`}
          />
          <span className="text-[11.5px] font-bold text-[#557d78]">{cur} حتى</span>
          <input
            type="date" dir="ltr" aria-label={`تاريخ الدفعة ${i + 1}`}
            value={p.date ?? ""} onChange={(e) => setPayment(i, { date: e.target.value || null })}
            className={`${basicField} tv-tnum w-40`}
          />
          <button type="button" aria-label="احذف الدفعة" onClick={() => onChange({ ...plan, payments: plan.payments.filter((_, j) => j !== i) })} className="text-[#c43d3d]">
            <X className="size-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange({ ...plan, payments: [...plan.payments, { date: null, amount: Math.max(0, gap) }] })} className="inline-flex items-center gap-1 text-[12px] font-bold text-[#185045] underline">
        <Plus className="size-3.5" />
        دفعة أخرى
      </button>

      <p role="status" className={`text-[12px] font-extrabold ${gap === 0 ? "text-[#0f7a52]" : "text-[#c43d3d]"}`}>
        {gap === 0
          ? `مجموع الدفعات يساوي الإجمالي (${fmt(total)} ${cur}) ✓`
          : gap > 0
            ? `مجموع الدفعات أقل من الإجمالي بـ ${fmt(gap)} ${cur} — عدّل الدفعات أو اضغط «قسّط».`
            : `مجموع الدفعات أكثر من الإجمالي بـ ${fmt(-gap)} ${cur} — عدّل الدفعات أو اضغط «قسّط».`}
      </p>
    </div>
  );
}
