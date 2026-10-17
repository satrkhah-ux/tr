"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import { setPaymentException } from "@/lib/data/operation-wizard";
import { paidTotal } from "@/lib/operations/payments";
import { clientStatusUnbacked, paidState, paymentPrefill } from "@/lib/operations/wizard/payment";
import type { StepProps } from "@/lib/operations/wizard/types";
import { PaymentsPanel } from "../PaymentsPanel";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { useSafeTransition } from "../../useSafeTransition";

const PAID_TONE = { paid: "bg-[#e9f7f0] text-[#0f7a52]", partial: "bg-[#fff8e8] text-[#a86a10]", unpaid: "bg-[#fdecef] text-[#c22850]" } as const;

/**
 * Step 5 — «الدفع»: the amount owed next is already in the form (the deposit,
 * the next installment, or the rest), the method, the receipt photo — the
 * case's own payments panel (PaymentsPanel), so the receipt, the schedule and
 * the corrections stay exactly as they are. Whether it is paid is read from
 * the RECORDED payments, never from the client track a hand can set.
 */
export function PaymentStep({ data, canManage }: StepProps) {
  const { t } = useTraveliunUI();
  const op = data.operation;
  const paid = paidTotal(data.payments);
  const state = paidState(op.total, paid);
  const prefill = paymentPrefill(data);

  return (
    <div className="space-y-3">
      <p className={`inline-flex rounded-full px-3 py-1 text-[12px] font-extrabold ${PAID_TONE[state]}`}>{t(`wz.pay.state.${state}` as TranslationKey)}</p>
      {clientStatusUnbacked(op.client_status, op.total, paid) ? <UnbackedStatus status={op.client_status} /> : null}
      {prefill ? (
        <p className="text-[12px] font-bold text-[#557d78]">
          {t(prefill.due_date ? "wz.pay.nextDue" : "wz.pay.next", {
            amount: prefill.amount.toLocaleString("en-US"),
            currency: op.currency ?? "SAR",
            kind: t(`ops.payment.${prefill.kind}` as TranslationKey),
            date: prefill.due_date ?? "",
          })}
        </p>
      ) : null}

      <PaymentsPanel operation={op} payments={data.payments} installments={data.installments} canManage={canManage} prefill={prefill} />

      {state !== "paid" ? <PaymentException data={data} canManage={canManage} /> : null}
    </div>
  );
}

/** The client track was set to «مسدّد» / «مسدّد جزئياً» by hand and the payments do not show it — said, not blocked. */
export function UnbackedStatus({ status }: { status: string }) {
  const { t } = useTraveliunUI();
  return (
    <p className="flex items-start gap-2 rounded-[10px] border border-[#f0d9a8] bg-[#fff8e8] px-3 py-2 text-[12px] font-bold text-[#a86a10]">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      {t("wz.pay.unbacked", { status: t(`ops.client.${status}` as TranslationKey) })}
    </p>
  );
}

/** «يسافر قبل السداد» — the manager's exception to the payment rule of «جاهز للسفر». */
function PaymentException({ data, canManage }: Pick<StepProps, "data" | "canManage">) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useSafeTransition();
  const granted = data.readyExceptions.payment;

  const save = (next: string | null) =>
    run(async () => {
      setError(null);
      const res = await setPaymentException(data.operation.id, next);
      if (!res.ok) setError(t(res.error));
      else router.refresh();
    });

  if (!granted && !canManage) return null;
  return (
    <div className="rounded-[12px] border border-[#dbe6e1] bg-[#f8fbf9] p-3">
      <p className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#185045]">
        <ShieldCheck className="size-4" />
        {t(granted ? "wz.pay.exception.on" : "wz.pay.exception.title")}
      </p>
      {granted ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] font-semibold text-[#557d78]">
          <span className="tv-tnum">{granted.at.slice(0, 10)}</span>
          {granted.note ? <span>— {granted.note}</span> : null}
          {canManage ? (
            <button type="button" disabled={pending} onClick={() => save(null)} className="ms-auto inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#f2c7c7] px-2.5 font-bold text-[#c43d3d] disabled:opacity-60">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t("wz.pay.exception.remove")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("wz.pay.exception.note")}
            className="h-10 min-w-0 flex-1 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[13px] text-[#185045]"
          />
          <button type="button" disabled={pending || !note.trim()} onClick={() => save(note)} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#185045] px-3.5 text-[12px] font-bold text-white disabled:opacity-60">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            {t("wz.pay.exception.grant")}
          </button>
        </div>
      )}
      {error ? <p className="mt-1.5 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
    </div>
  );
}
