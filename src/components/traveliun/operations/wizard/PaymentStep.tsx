"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import { DirText } from "@/components/DirText";
import { setPaymentException } from "@/lib/data/operation-wizard";
import { setAgreedTotal } from "@/lib/data/operation-payments";
import { paidTotal } from "@/lib/operations/payments";
import { clientStatusUnbacked, paidState, paymentChoices } from "@/lib/operations/wizard/payment";
import type { StepProps } from "@/lib/operations/wizard/types";
import { PaymentsPanel } from "../PaymentsPanel";
import { PaymentLinkPanel } from "../PaymentLinkPanel";
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
  const choices = paymentChoices(data);
  // «سدّد قسطاً» until the employee picks another — the old step's own default
  const [choice, setChoice] = useState<Choice>("installment");
  const prefill = choices ? (choice === "full" ? choices.full : choices.installment) : null;

  return (
    <div className="space-y-3">
      <p className={`inline-flex rounded-full px-3 py-1 text-[12px] font-extrabold ${PAID_TONE[state]}`}>{t(`wz.pay.state.${state}` as TranslationKey)}</p>
      {clientStatusUnbacked(op.client_status, op.total, paid) ? <UnbackedStatus status={op.client_status} /> : null}

      {/* ١ — the price the client was sent (the owner, 2026-10-29) */}
      <AgreedPrice data={data} canManage={canManage} />

      {/* ٢ — how this payment goes: one line, the whole rest, or a plan */}
      {choices ? (
        <div>
          <p className="mb-1.5 text-[12px] font-extrabold text-[#185045]">{t("wz.pay.choice.title")}</p>
          <div role="radiogroup" aria-label={t("wz.pay.choice.title")} className="grid gap-1.5 sm:grid-cols-3">
            {CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={choice === c}
                onClick={() => setChoice(c)}
                className={`rounded-[11px] border px-3 py-2.5 text-start transition-colors ${
                  choice === c ? "border-[#185045] bg-[#f0f7f4]" : "border-[#dbe6e1] bg-white hover:bg-[#f8fbf9]"
                }`}
              >
                <span className="block text-[13px] font-extrabold text-[#0f3d38]">{t(`wz.pay.choice.${c}` as TranslationKey)}</span>
                <span className="tv-tnum mt-0.5 block text-[11.5px] font-semibold text-tv-text-faint">
                  {c === "plan"
                    ? t("wz.pay.choice.planHint")
                    : `${(c === "full" ? choices.full : choices.installment).amount.toLocaleString("en-US")} ${op.currency ?? "SAR"}`}
                </span>
              </button>
            ))}
          </div>
          {choice === "plan" && !canManage ? <p className="mt-1.5 text-[11.5px] font-semibold text-tv-text-faint">{t("wz.pay.choice.planManager")}</p> : null}
        </div>
      ) : null}

      <PaymentsPanel
        operation={op}
        payments={data.payments}
        installments={data.installments}
        canManage={canManage}
        prefill={choice === "plan" ? null : prefill}
        planOpen={choice === "plan"}
        defaultMethod={data.payMethod ?? null}
      />

      {/* ٣ — a payment link for the amount chosen: prepared, reviewed, then sent by press (never by itself) */}
      {choices && !op.partner_id && choice !== "plan" && prefill ? (
        <PaymentLinkPanel operationId={op.id} amount={prefill.amount} customerName={op.customer_name ?? ""} />
      ) : null}

      {state !== "paid" ? <PaymentException data={data} canManage={canManage} /> : null}
    </div>
  );
}

type Choice = "installment" | "full" | "plan";
const CHOICES: Choice[] = ["installment", "full", "plan"];

/**
 * «السعر المعروض المرسل للعميل»: what the case owes — the offer's total unless
 * the employee wrote the price the client was actually sent (a payment fee from
 * the calculator, a discount). The manager writes it (setAgreedTotal: the same
 * gate as the schedule); everyone else reads it. Clearing it returns to the offer's.
 */
function AgreedPrice({ data, canManage }: Pick<StepProps, "data" | "canManage">) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const op = data.operation;
  const currency = op.currency ?? "SAR";
  const offerTotal = op.offer_total ?? op.total;
  const agreed = op.agreed_total ?? null;
  const [value, setValue] = useState(op.total != null ? String(op.total) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useSafeTransition();
  const fmt = (n: number) => n.toLocaleString("en-US");

  const save = (next: number | null) =>
    run(async () => {
      setError(null);
      // writing the offer's own figure is the same as clearing it
      const res = await setAgreedTotal(op.id, next !== null && offerTotal != null && Math.abs(next - offerTotal) < 0.005 ? null : next);
      if (!res.ok) setError(t(res.error));
      else router.refresh();
    });

  const typed = Number(value);
  const changed = value.trim() !== "" && Number.isFinite(typed) && typed > 0 && Math.abs(typed - (op.total ?? 0)) >= 0.005;

  return (
    <div className="rounded-[12px] border border-[#dbe6e1] bg-[#f8fbf9] p-3">
      <p className="text-[12px] font-extrabold text-[#185045]">{t("wz.pay.agreed.title")}</p>
      {canManage ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input
            type="number" inputMode="decimal"
            min={0}
            step="0.01"
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={t("wz.pay.agreed.title")}
            className="tv-tnum h-10 w-40 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-center text-[14px] font-extrabold text-[#0f3d38] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
          />
          <span className="text-[12px] font-bold text-[#557d78]">{currency}</span>
          {changed ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => save(typed)}
              className="tv-btn-primary inline-flex h-10 items-center gap-1.5 rounded-[10px] px-3.5 text-[12px] font-bold disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t("save")}
            </button>
          ) : null}
          {agreed != null ? (
            <button type="button" disabled={pending} onClick={() => save(null)} className="text-[11.5px] font-bold text-[#557d78] underline disabled:opacity-60">
              {t("wz.pay.agreed.reset")}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="tv-tnum mt-1 text-[16px] font-extrabold text-[#0f3d38]">
          <DirText dir="ltr">{op.total == null ? "—" : `${fmt(op.total)} ${currency}`}</DirText>
        </p>
      )}
      <p className="tv-tnum mt-1.5 text-[11px] font-semibold text-tv-text-faint">
        {agreed != null && offerTotal != null
          ? t("wz.pay.agreed.fromOffer", { offer: fmt(offerTotal), currency })
          : t("wz.pay.agreed.hint")}
      </p>
      {error ? <p className="mt-1.5 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
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
            <button type="button" disabled={pending} onClick={() => save(null)} className="ms-auto inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#f2c7c7] px-2.5 font-bold text-[#c43d3d] disabled:opacity-60 max-sm:min-h-10">
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
          <button type="button" disabled={pending || !note.trim()} onClick={() => save(note)} className="tv-btn-primary inline-flex h-10 items-center gap-1.5 rounded-[10px] px-3.5 text-[12px] font-bold disabled:opacity-60">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            {t("wz.pay.exception.grant")}
          </button>
        </div>
      )}
      {error ? <p className="mt-1.5 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
    </div>
  );
}
