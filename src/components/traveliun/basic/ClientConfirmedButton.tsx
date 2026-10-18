"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { confirmFromBasic, type FileError } from "@/lib/data/file-status";
import { useBasicLabels } from "./labels";

const CHANNELS = ["whatsapp", "phone", "office"] as const;
type Channel = (typeof CHANNELS)[number];

/**
 * «العميل أكّد» on a file waiting on its client, right in the files list (the
 * owner, 2026-10-17: «كيف أغير الحالة إلى مؤكد كي أنتقل إلى قسم الحجوزات؟»).
 * One press asks how the client said yes; the choice confirms the file — the
 * same confirmation as the file's own panel and the kanban (confirmFromBasic →
 * confirmOffer: the operations case opens) — and goes straight to its bookings.
 */
export function ClientConfirmedButton({
  draftId,
  className = "",
  expired = false,
  secondary = false,
}: {
  draftId: string;
  className?: string;
  expired?: boolean;
  /** before the file is sent: a framed button beside the filled «أرسل للعميل» */
  secondary?: boolean;
}) {
  const tx = useBasicLabels();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm(channel: Channel) {
    if (expired && !window.confirm(tx("confirmExpired"))) return;
    setBusy(channel);
    setError(null);
    try {
      const r = await confirmFromBasic(draftId, channel);
      if (!r.ok) return setError(tx(ERR[r.error] ?? "fileErr_failed"));
      if (r.canOpen) router.push(`/operations/${r.operationId}`);
      else router.refresh();
    } catch {
      setError(tx("fileErr_failed"));
    } finally {
      setBusy(null);
    }
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className={`inline-flex h-8 items-center justify-center gap-1 rounded-[8px] text-[11.5px] font-bold ${secondary ? "border border-[#0f7a52] bg-white text-[#0f7a52] hover:bg-[#e9f7f0]" : "bg-[#0f7a52] text-white hover:bg-[#0b6140]"} ${className}`}
      >
        <CheckCircle2 className="size-3.5" />
        {tx("clientConfirmedBtn")}
      </button>
    );
  }
  return (
    <span className="relative inline-flex">
      <span className="absolute end-0 top-full z-30 mt-1 grid w-60 gap-1 rounded-[10px] border border-[#bfe5d4] bg-white p-2 shadow-[0_8px_24px_rgba(0,60,58,0.14)]">
        <span className="flex items-center justify-between text-[11.5px] font-extrabold text-[#185045]">
          {tx("howConfirmed")}
          <button type="button" aria-label={tx("closeLabel")} onClick={() => setAsking(false)} className="rounded p-0.5 text-[#78948f] hover:bg-[#f4f8f6]">
            <X className="size-3.5" />
          </button>
        </span>
        {CHANNELS.map((c) => (
          <button
            key={c}
            type="button"
            disabled={busy != null}
            onClick={() => void confirm(c)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#cfe0d9] px-2 text-start text-[12px] font-bold text-[#0f7a52] hover:bg-[#e9f7f0] disabled:opacity-60"
          >
            {busy === c ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            {tx(`channel_${c}`)}
          </button>
        ))}
        <span className="text-[10.5px] font-semibold text-[#78948f]">{tx("confirmGoesToBookings")}</span>
        {error ? <span className="text-[11px] font-bold text-[#c22850]">{error}</span> : null}
      </span>
      <button type="button" onClick={() => setAsking(false)} className={`inline-flex h-8 items-center justify-center gap-1 rounded-[8px] bg-[#0b6140] text-[11.5px] font-bold text-white ${className}`}>
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
