"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarClock, ExternalLink, FileText, Loader2, Paperclip, Pencil, Plus, Trash2, Wallet, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import { recordPayment, type OperationCard, type OperationPayment, type PaymentKind, type PaymentMethod } from "@/lib/data/operations";
import {
  deletePayment,
  ensurePaymentReceipt,
  getPaymentProofUrl,
  saveInstallments,
  updatePayment,
  uploadPaymentProof,
  type InstallmentRow,
} from "@/lib/data/operation-payments";
import {
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  defaultSchedule,
  installmentStates,
  paidTotal,
  remainingBalance,
  riyadhDate,
  type InstallmentState,
} from "@/lib/operations/payments";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition, useSessionField } from "../useSafeTransition";

/**
 * «الدفعات» on the case page: what is paid and what is left, the full payment
 * form (method, reference, date, proof, note), correcting or deleting a
 * payment, its «سند قبض», and the installment schedule.
 */

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "h-10 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";
const label = "grid gap-1.5 text-[12px] font-bold text-[#185045]";
const chip =
  "inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

const STATE_TONE: Record<InstallmentState, string> = {
  paid: "bg-[#e9f7f0] text-[#0f7a52]",
  partial: "bg-[#fff8e8] text-[#a86a10]",
  overdue: "bg-[#fdecef] text-[#c22850]",
  due: "bg-[#eef4f1] text-[#557d78]",
};

export function PaymentsPanel({
  operation,
  payments,
  installments,
  canManage,
  prefill,
  planOpen = false,
  defaultMethod = null,
}: {
  operation: OperationCard;
  payments: OperationPayment[];
  installments: InstallmentRow[];
  /** «معالج الحجوزات»: the amount and kind owed next, already in the new-payment form. */
  prefill?: { amount: number; kind: PaymentKind } | null;
  /** «دفع بالتقسيط» chosen: the schedule opens for editing (a manager's step) */
  planOpen?: boolean;
  /**
   * The manager's step on this case — operations.write, or manage_own on one's
   * own file: correct / delete a payment, record a refund, set the schedule.
   * Without it an own-files holder records money IN and attaches its slip; the
   * server refuses the rest either way (operation-payments.ts).
   */
  canManage: boolean;
  /** the way the client chose on the file (pricing.payment_method): a new payment starts on it */
  defaultMethod?: PaymentMethod | null;
}) {
  const { t } = useTraveliunUI();
  const currency = operation.currency ?? "SAR";
  const paid = paidTotal(payments);
  const remaining = remainingBalance(operation.total, paid);
  const [editing, setEditing] = useState<OperationPayment | null>(null);
  // bumped after a save so the form starts clean
  const [formKey, setFormKey] = useState(0);
  // survives the form's reset: a saved payment whose slip did not upload
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section id="payments" className={`${card} scroll-mt-24`}>
      <h2 className="text-sm font-extrabold text-[#185045]">{t("ops.payments")}</h2>

      <div
        className={`mt-3 rounded-[11px] px-4 py-3 ${
          remaining != null && remaining <= 0 ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#fff8e8] text-[#a86a10]"
        }`}
      >
        <p className="text-[11.5px] font-bold opacity-70">
          {remaining != null && remaining <= 0 ? t("ops.pay.settled") : t("ops.pay.remaining")}
        </p>
        <p className="tv-tnum mt-0.5 text-[20px] font-extrabold">
          <DirText dir="ltr">{remaining == null ? "—" : `${fmt(Math.max(remaining, 0))} ${currency}`}</DirText>
        </p>
        <p className="tv-tnum mt-1 text-[11.5px] font-bold opacity-80">
          {t("ops.pay.paid")} <DirText dir="ltr">{`${fmt(paid)} ${currency}`}</DirText>
          <span className="mx-1.5 opacity-50">·</span>
          {t("ops.pay.total")} <DirText dir="ltr">{operation.total == null ? "—" : `${fmt(operation.total)} ${currency}`}</DirText>
        </p>
      </div>

      <PaymentForm
        // a new amount owed (after a save and the refresh) is a fresh form
        key={editing?.id ?? `new-${formKey}-${prefill?.amount ?? ""}`}
        operationId={operation.id}
        currency={currency}
        editing={editing}
        prefill={editing ? null : (prefill ?? null)}
        defaultMethod={defaultMethod}
        canManage={canManage}
        onDone={(message) => {
          setEditing(null);
          setFormKey((k) => k + 1);
          setNotice(message ?? null);
        }}
      />
      {notice ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{notice}</p> : null}

      {payments.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-[#f0f4f2] pt-3">
          {payments.map((p) => (
            <PaymentItem key={p.id} payment={p} onEdit={canManage ? () => setEditing(p) : null} />
          ))}
        </ul>
      ) : null}

      <Schedule key={planOpen ? "plan" : "view"} operation={operation} installments={installments} paid={paid} currency={currency} canManage={canManage} startEditing={planOpen} />
    </section>
  );
}

function PaymentForm({
  operationId,
  currency,
  editing,
  prefill,
  defaultMethod,
  canManage,
  onDone,
}: {
  operationId: string;
  currency: string;
  editing: OperationPayment | null;
  prefill?: { amount: number; kind: PaymentKind } | null;
  defaultMethod: PaymentMethod | null;
  canManage: boolean;
  /** saved; `message` when the payment is in but its slip is not. */
  onDone: (message?: string) => void;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  // kept in this tab until saved — a reload after a deploy used to lose it
  // one kept slot per choice («سدّد قسطاً» / «دفع كامل»): switching choice shows ITS amount, not one typed under the other
  const [amount, setAmount, forgetAmount] = useSessionField(`pay:${operationId}:${editing?.id ?? `new-${prefill?.kind ?? ""}`}`, editing ? String(editing.amount) : prefill ? String(prefill.amount) : "");
  const [kind, setKind] = useState<PaymentKind>(editing?.kind ?? prefill?.kind ?? "deposit");
  const [method, setMethod] = useState<PaymentMethod | "">(editing ? (editing.method ?? "") : (defaultMethod ?? ""));
  const [reference, setReference] = useState(editing?.reference ?? "");
  const [date, setDate] = useState(editing?.paid_at ?? riyadhDate());
  const [note, setNote] = useState(editing?.note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useSafeTransition();

  function save() {
    startTransition(async () => {
      setError(null);
      const input = { amount: Number(amount), kind, method: method || null, reference, paid_at: date, note };
      let id = editing?.id ?? "";
      if (editing) {
        const res = await updatePayment(editing.id, input);
        if (!res.ok) return setError(t(res.error));
      } else {
        const res = await recordPayment({ operation_id: operationId, currency, ...input });
        if (!res.ok) return setError(t(res.error));
        id = res.id;
      }
      forgetAmount();
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        // A throw here (a slip over the server-action body limit) must not reach
        // useSafeTransition: the payment IS saved, so clear the form and say so
        // rather than invite a second one.
        const up = await uploadPaymentProof(id, fd).catch(() => null);
        if (!up?.ok) {
          onDone(t("ops.pay.proofUploadFailed"));
          router.refresh();
          return;
        }
      }
      onDone();
      router.refresh();
    });
  }

  return (
    <div className={`mt-3 grid gap-2 rounded-[11px] border p-3 sm:grid-cols-2 ${editing ? "border-[#b7d0c7] bg-[#f0f7f4]" : "border-[#e2ebe7] bg-[#f8fbf9]"}`}>
      {editing ? <p className="text-[12px] font-extrabold text-[#185045] sm:col-span-2">{t("ops.pay.editing")}</p> : null}
      <label className={label}>
        {t("ops.payment.amount")}
        <input type="number" inputMode="decimal" min={0} step="0.01" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} tv-tnum text-center`} />
      </label>
      <label className={label}>
        {t("ops.payment.kind")}
        <select value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)} className={field}>
          {/* a refund is money going out — the manager's */}
          {PAYMENT_KINDS.filter((k) => canManage || k !== "refund").map((k) => (
            <option key={k} value={k}>
              {t(`ops.payment.${k}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {t("ops.payment.method")}
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | "")} className={field}>
          <option value="">{t("ops.pay.methodPick")}</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`ops.pay.method.${m}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {t("ops.pay.date")}
        <input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} tv-tnum`} />
      </label>
      <label className={`${label} sm:col-span-2`}>
        {t("ops.payment.reference")}
        <input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} className={`${field} text-start`} />
      </label>
      <label className={`${label} sm:col-span-2`}>
        {t("ops.pay.note")}
        <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
      </label>
      <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-[10px] border border-dashed border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4] sm:col-span-2">
        <Paperclip className="size-3.5 shrink-0" />
        <span className="truncate">{file ? file.name : t("ops.pay.proofAttach")}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button
          type="button"
          disabled={pending || !(Number(amount) > 0) || !date}
          onClick={save}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
          {editing ? t("save") : t("ops.payment.add")}
        </button>
        {editing ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              forgetAmount();
              onDone();
            }}
            className={`${chip} h-10`}
          >
            {t("cancel")}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-[12px] font-bold text-[#c22850] sm:col-span-2">{error}</p> : null}
    </div>
  );
}

/** `onEdit` null: no edit / delete — correcting or erasing a money record is the manager's. */
function PaymentItem({ payment, onEdit }: { payment: OperationPayment; onEdit: (() => void) | null }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useSafeTransition();
  const refund = payment.kind === "refund";

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: TranslationKey }>) =>
    startTransition(async () => {
      setError(null);
      const res = await action();
      if (!res.ok) setError(t(res.error));
      else router.refresh();
    });

  function openProof() {
    startTransition(async () => {
      setError(null);
      const res = await getPaymentProofUrl(payment.id);
      if (!res.ok) setError(t(res.error));
      else window.open(res.url, "_blank", "noopener");
    });
  }

  return (
    <li className="rounded-[11px] border border-[#e2ebe7] p-3">
      <div className="flex items-start justify-between gap-2 text-[12px] font-bold">
        <div className="min-w-0">
          <p className="text-[#0f3d38]">
            {t(`ops.payment.${payment.kind}` as TranslationKey)}
            {payment.method ? <span className="ms-2 font-semibold text-[#557d78]">{t(`ops.pay.method.${payment.method}` as TranslationKey)}</span> : null}
          </p>
          <p className="tv-tnum mt-0.5 font-semibold text-tv-text-faint">
            <DirText dir="ltr">{payment.paid_at}</DirText>
            {payment.reference ? (
              <span className="ms-2">
                <DirText dir="ltr">{payment.reference}</DirText>
              </span>
            ) : null}
            {payment.receipt_no ? (
              <span className="ms-2">
                <DirText dir="ltr">{payment.receipt_no}</DirText>
              </span>
            ) : null}
          </p>
          {payment.note ? <p className="mt-0.5 font-semibold text-tv-text-faint">{payment.note}</p> : null}
        </div>
        <span className={`tv-tnum shrink-0 ${refund ? "text-[#c22850]" : "text-[#0f3d38]"}`}>
          <DirText dir="ltr">{`${refund ? "-" : ""}${fmt(payment.amount)} ${payment.currency}`}</DirText>
        </span>
      </div>

      {confirming ? (
        // in-page, not window.confirm: the step stays inside the app's look and cannot be auto-dismissed
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[9px] bg-[#fdecef] px-3 py-2">
          <p className="me-auto text-[11.5px] font-bold text-[#c22850]">{t("ops.pay.deleteConfirm")}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => deletePayment(payment.id))}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#c22850] px-3 text-[11.5px] font-bold text-white disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {t("delete")}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={chip}>
            {t("cancel")}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {refund ? null : payment.receipt_token ? (
            <a href={`/trip/receipt/${payment.receipt_token}/pdf`} target="_blank" rel="noopener" className={chip}>
              <FileText className="size-3.5" />
              {t("ops.pay.receipt")}
            </a>
          ) : (
            // a payment from before receipts existed: give it one now
            <button type="button" disabled={pending} onClick={() => run(() => ensurePaymentReceipt(payment.id))} className={chip}>
              <FileText className="size-3.5" />
              {t("ops.pay.receiptIssue")}
            </button>
          )}
          {payment.has_proof ? (
            <button type="button" disabled={pending} onClick={openProof} className={chip}>
              <ExternalLink className="size-3.5" />
              {t("ops.pay.proofOpen")}
            </button>
          ) : null}
          {onEdit ? (
            <>
              <button type="button" disabled={pending} onClick={onEdit} className={chip}>
                <Pencil className="size-3.5" />
                {t("edit")}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#f2c7c7] px-2.5 text-[11.5px] font-bold text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60"
              >
                <Trash2 className="size-3.5" />
                {t("delete")}
              </button>
            </>
          ) : null}
        </div>
      )}
      {error ? <p className="mt-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
    </li>
  );
}

function Schedule({
  operation,
  installments,
  paid,
  currency,
  canManage,
  startEditing = false,
}: {
  operation: OperationCard;
  installments: InstallmentRow[];
  paid: number;
  currency: string;
  /** the client's payment terms are the manager's to set */
  canManage: boolean;
  /** opened from «دفع بالتقسيط»: the editor is already open (for a manager) */
  startEditing?: boolean;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const today = riyadhDate();
  const stored = installments.length > 0;
  const schedule = stored
    ? installments
    : defaultSchedule({ total: operation.total, confirmed_on: riyadhDate(operation.confirmed_at), travel_start: operation.travel_start });
  const rows = installmentStates(schedule, paid, today);
  const [draft, setDraft] = useState<{ due_date: string; amount: string }[] | null>(() =>
    startEditing && canManage
      ? schedule.length > 0
        ? schedule.map((r) => ({ due_date: r.due_date ?? "", amount: String(r.amount) }))
        : [{ due_date: today, amount: operation.total != null ? String(operation.total) : "" }]
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useSafeTransition();

  const draftSum = (draft ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const mismatch = draft && operation.total != null && Math.abs(draftSum - operation.total) > 0.005;

  const save = (next: { due_date: string; amount: number }[]) =>
    startTransition(async () => {
      setError(null);
      const res = await saveInstallments(operation.id, next);
      if (!res.ok) setError(t(res.error));
      else {
        setDraft(null);
        router.refresh();
      }
    });

  const setRow = (i: number, patch: Partial<{ due_date: string; amount: string }>) =>
    setDraft((d) => (d ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="mt-4 border-t border-[#f0f4f2] pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-extrabold text-[#185045]">
          <CalendarClock className="size-4" />
          {t("ops.pay.schedule")}
        </h3>
        {draft || !canManage ? null : (
          <div className="flex flex-wrap gap-1.5">
            {stored ? (
              <button type="button" disabled={pending} onClick={() => save([])} className={chip}>
                {t("ops.pay.scheduleReset")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                setDraft(
                  schedule.length > 0
                    ? schedule.map((r) => ({ due_date: r.due_date ?? "", amount: String(r.amount) }))
                    : [{ due_date: today, amount: operation.total != null ? String(operation.total) : "" }],
                )
              }
              className={chip}
            >
              <Pencil className="size-3.5" />
              {t("ops.pay.scheduleEdit")}
            </button>
          </div>
        )}
      </div>
      {stored ? null : <p className="mt-1 text-[11px] font-semibold text-tv-text-faint">{t("ops.pay.scheduleDefault")}</p>}

      {draft ? (
        <div className="mt-2 space-y-2">
          {draft.map((r, i) => (
            <div key={i} className="flex items-end gap-2">
              <label className={`${label} flex-1`}>
                {t("ops.pay.dueDate")}
                <input type="date" dir="ltr" value={r.due_date} onChange={(e) => setRow(i, { due_date: e.target.value })} className={`${field} tv-tnum`} />
              </label>
              <label className={`${label} flex-1`}>
                {t("ops.payment.amount")}
                <input
                  type="number" inputMode="decimal"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={r.amount}
                  onChange={(e) => setRow(i, { amount: e.target.value })}
                  className={`${field} tv-tnum text-center`}
                />
              </label>
              <button
                type="button"
                aria-label={t("delete")}
                onClick={() => setDraft((d) => (d ?? []).filter((_, j) => j !== i))}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-[#f2c7c7] text-[#c43d3d] hover:bg-[#fff1f1]"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setDraft((d) => [...(d ?? []), { due_date: "", amount: "" }])} className={chip}>
            <Plus className="size-3.5" />
            {t("ops.pay.scheduleAdd")}
          </button>
          {mismatch ? (
            <p className="text-[11.5px] font-bold text-[#a86a10]">
              {t("ops.pay.scheduleMismatch", { sum: fmt(draftSum), total: fmt(operation.total ?? 0) })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || draft.length === 0 || draft.some((r) => !r.due_date || !(Number(r.amount) > 0))}
              onClick={() => save(draft.map((r) => ({ due_date: r.due_date, amount: Number(r.amount) })))}
              className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("save")}
            </button>
            <button type="button" disabled={pending} onClick={() => setDraft(null)} className={`${chip} h-9`}>
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-[11.5px] font-semibold text-tv-text-faint">{t("ops.pay.noTotal")}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-[12px] font-bold">
              <span className="tv-tnum text-[#557d78]">
                {r.due_date ? <DirText dir="ltr">{r.due_date}</DirText> : t("ops.pay.noDueDate")}
              </span>
              <span className="flex items-center gap-2">
                <span className="tv-tnum text-[#0f3d38]">
                  <DirText dir="ltr">{`${fmt(r.amount)} ${currency}`}</DirText>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] ${STATE_TONE[r.state]}`}>{t(`ops.pay.state.${r.state}` as TranslationKey)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="mt-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
    </div>
  );
}
