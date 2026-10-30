"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { basicAgreementContext, confirmFromBasic, type FileError } from "@/lib/data/file-status";
import type { AgreementContext } from "@/lib/data/payment-agreement";
import type { Agreement } from "@/lib/operations/agreement";
import { useBasicLabels, type BasicLabel } from "./labels";
import { PaymentAgreementDialog } from "./PaymentAgreementDialog";

const CHANNELS = ["whatsapp", "phone", "office"] as const;
type Channel = (typeof CHANNELS)[number];

/** What a confirmation answers with — Basic's confirmFromBasic, and the repackage's confirmRepackageOrder. */
export type ConfirmAnswer = { ok: true; operationId: string; canOpen: boolean; agreementFailed?: string } | { ok: false; error: string };

/**
 * «العميل أكّد» on a file waiting on its client, right in the files list (the
 * owner, 2026-10-17: «كيف أغير الحالة إلى مؤكد كي أنتقل إلى قسم الحجوزات؟»).
 * One press asks how the client said yes; the choice confirms the file — the
 * same confirmation as the file's own panel and the kanban (confirmFromBasic →
 * confirmOffer: the operations case opens) — and goes straight to its bookings.
 *
 * A repackaged file asks the same way (`confirm`: its own id, the same
 * confirmOffer) and stays on its screen (`onConfirmed`), where the supplier's
 * order comes next; the kanban passes the offer's id the same way.
 *
 * After the channel, «كيف تم الاتفاق المالي؟» (PaymentAgreementDialog, the
 * owner 2026-10-30) — or «لاحقاً». The agreement goes with the confirmation in
 * one server call; if the case opened but the agreement could not be saved,
 * the employee is told and lands on the case's payment step.
 */
export function ClientConfirmedButton({
  draftId,
  className = "",
  expired = false,
  secondary = false,
  confirm: confirmWith = confirmFromBasic,
  context: loadContext = basicAgreementContext,
  onConfirmed,
}: {
  draftId: string;
  className?: string;
  expired?: boolean;
  /** before the file is sent: a framed button beside the filled «أرسل للعميل» */
  secondary?: boolean;
  /** confirms the file known here by `draftId` — Basic's draft by default. */
  confirm?: (id: string, channel: Channel, agreement: Agreement) => Promise<ConfirmAnswer>;
  /** what the agreement dialog starts from — the file's total, way of paying and travel day */
  context?: (id: string) => Promise<AgreementContext | null>;
  /** called with the answer instead of opening the case. */
  onConfirmed?: (answer: Extract<ConfirmAnswer, { ok: true }>) => void;
}) {
  const tx = useBasicLabels();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [ctx, setCtx] = useState<AgreementContext | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(c: Channel) {
    if (expired && !window.confirm(tx("confirmExpired"))) return;
    setChannel(c);
    setError(null);
    if (ctx === undefined) loadContext(draftId).then(setCtx, () => setCtx(null));
  }

  async function confirm(agreement: Agreement) {
    if (!channel) return;
    setBusy(true);
    setError(null);
    try {
      const r = await confirmWith(draftId, channel, agreement);
      if (!r.ok) return setError(r.error.startsWith("agree_") ? tx(r.error as BasicLabel) : tx(ERR[r.error as FileError] ?? "fileErr_failed"));
      setChannel(null);
      if (r.agreementFailed) {
        window.alert(tx("agree_failed"));
        if (r.canOpen) return router.push(`/operations/${r.operationId}?step=payment`);
      }
      if (onConfirmed) onConfirmed(r);
      else if (r.canOpen) router.push(`/operations/${r.operationId}`);
      else router.refresh();
    } catch {
      setError(tx("fileErr_failed"));
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <PaymentAgreementDialog open={channel !== null} context={ctx} busy={busy} error={error} onBack={() => setChannel(null)} onSubmit={(a) => void confirm(a)} />
  );

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className={`inline-flex h-8 items-center justify-center gap-1 rounded-[8px] text-[11.5px] font-bold max-sm:min-h-10 ${secondary ? "border border-[#0f7a52] bg-white text-[#0f7a52] hover:bg-[#e9f7f0]" : "bg-[#0f7a52] text-white hover:bg-[#0b6140]"} ${className}`}
      >
        <CheckCircle2 className="size-3.5" />
        {tx("clientConfirmedBtn")}
      </button>
    );
  }
  return (
    <span className="relative inline-flex">
      {dialog}
      <span className="absolute end-0 top-full z-30 mt-1 grid w-60 gap-1 rounded-[10px] border border-[#bfe5d4] bg-white p-2 shadow-[0_8px_24px_rgba(0,60,58,0.14)]">
        <span className="flex items-center justify-between text-[11.5px] font-extrabold text-[#185045]">
          {tx("howConfirmed")}
          <button type="button" aria-label={tx("closeLabel")} onClick={() => setAsking(false)} className="rounded p-0.5 text-tv-text-faint hover:bg-[#f4f8f6]">
            <X className="size-3.5" />
          </button>
        </span>
        {CHANNELS.map((c) => (
          <button
            key={c}
            type="button"
            disabled={busy}
            onClick={() => pick(c)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#cfe0d9] px-2 text-start text-[12px] font-bold text-[#0f7a52] hover:bg-[#e9f7f0] disabled:opacity-60"
          >
            {busy && channel === c ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            {tx(`channel_${c}`)}
          </button>
        ))}
        <span className="text-[10.5px] font-semibold text-tv-text-faint">{tx("confirmGoesToBookings")}</span>
        {error ? <span className="text-[11px] font-bold text-[#c22850]">{error}</span> : null}
      </span>
      <button type="button" onClick={() => setAsking(false)} className={`inline-flex h-8 items-center justify-center gap-1 rounded-[8px] bg-[#0b6140] text-[11.5px] font-bold text-white max-sm:min-h-10 ${className}`}>
        <CheckCircle2 className="size-3.5" />
        {tx("clientConfirmedBtn")}
      </button>
    </span>
  );
}

const ERR: Partial<Record<FileError, "fileErr_forbidden" | "fileErr_cancelled" | "fileErr_partner" | "fileErr_failed">> = {
  forbidden: "fileErr_forbidden",
  cancelled: "fileErr_cancelled",
  partner: "fileErr_partner",
};
