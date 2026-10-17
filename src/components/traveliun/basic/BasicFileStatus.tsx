"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BriefcaseBusiness, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { cancelFile, confirmFromBasic, getFileStatus, type FileError, type FileStatusView } from "@/lib/data/file-status";
import { AWAITING_CLIENT, SENDABLE, type TimelineEntry } from "@/lib/offer/file-state";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { OfferSend } from "../OfferSend";
import { FileStateChip } from "./FileStateChip";
import { useBasicLabels } from "./labels";

const ERR: Partial<Record<FileError, "fileErr_forbidden" | "fileErr_cancelled" | "fileErr_empty" | "fileErr_partner" | "fileErr_inOperations" | "fileErr_already">> = {
  forbidden: "fileErr_forbidden",
  cancelled: "fileErr_cancelled",
  empty: "fileErr_empty",
  partner: "fileErr_partner",
  inOperations: "fileErr_inOperations",
  already: "fileErr_already",
};

const when = (iso: string, language: string) =>
  new Date(iso).toLocaleString(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
    timeZone: "Asia/Riyadh",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Where an issued Basic file stands (the owner, 2026-10-17) — `chip` for the
 * top bar, `panel` for the finish step: the history, «أرسل إلى العميل عبر
 * واتساب» (OfferSend), «العميل أكّد» and «إلغاء الملف». Staff only; it reads
 * its own data, again whenever `refresh` changes.
 */
export function BasicFileStatus({
  draftId,
  serial,
  variant,
  refresh = 0,
  onChanged,
}: {
  draftId: string;
  serial: string;
  variant: "chip" | "panel";
  refresh?: number;
  onChanged?: () => void;
}) {
  const tx = useBasicLabels();
  const { t, language } = useTraveliunUI();
  const router = useRouter();
  const [view, setView] = useState<FileStatusView | null>(null);
  const [tick, setTick] = useState(0);
  const [channel, setChannel] = useState<"whatsapp" | "phone" | "office">("whatsapp");
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    void getFileStatus(draftId).then((r) => {
      if (live) setView(r.ok ? r : null);
    });
    return () => {
      live = false;
    };
  }, [draftId, serial, refresh, tick]);

  if (!view) return null;
  if (variant === "chip") return <FileStateChip state={view.state} version={view.version} sentVersion={view.sentVersion} stale={view.stale} />;

  const changed = () => {
    setTick((n) => n + 1);
    onChanged?.();
  };
  const fail = (e: FileError) => setMessage({ text: tx(ERR[e] ?? "fileErr_failed"), ok: false });

  async function confirm() {
    if (view?.state === "expired" && !window.confirm(tx("confirmExpired"))) return;
    setBusy("confirm");
    setMessage(null);
    try {
      const r = await confirmFromBasic(draftId, channel);
      if (!r.ok) return fail(r.error);
      if (r.canOpen) {
        setMessage({ text: tx("confirmDone"), ok: true });
        router.push(`/operations/${r.operationId}`);
      } else setMessage({ text: tx("confirmDoneTeam"), ok: true });
      changed();
    } catch {
      fail("failed");
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy("cancel");
    setMessage(null);
    try {
      const r = await cancelFile(draftId, reason);
      if (!r.ok) return fail(r.error);
      setCancelling(false);
      setReason("");
      changed();
    } catch {
      fail("failed");
    } finally {
      setBusy(null);
    }
  }

  const line = (e: TimelineEntry) => {
    if (e.key === "client" || e.key === "execution") {
      const track = e.key === "client" ? "ops.client." : "ops.exec.";
      return `${tx(e.key === "client" ? "ev_client" : "ev_execution")}: ${e.status ? t(`${track}${e.status}` as TranslationKey) : "—"}`;
    }
    return tx(`ev_${e.key}`, { v: e.version ?? "" });
  };
  const awaiting = AWAITING_CLIENT.includes(view.state);
  // until the client has the newest version — a confirmed file re-issued included
  const sendable =
    view.canAct && !view.partner && SENDABLE.includes(view.state) && (awaiting || view.sentVersion == null || (view.version ?? 0) > view.sentVersion);
  const shown = all ? view.timeline : view.timeline.slice(0, 6);

  return (
    <div className="mt-3 space-y-3 rounded-[12px] border border-[#dbe6e1] bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileStateChip state={view.state} version={view.version} sentVersion={view.sentVersion} stale={view.stale} />
        {view.canOpenCase && view.operationId ? (
          <Link
            href={`/operations/${view.operationId}`}
            className="ms-auto inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#cfe0d9] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
          >
            <BriefcaseBusiness className="size-3.5" />
            {tx("openOperations")}
          </Link>
        ) : null}
      </div>

      {/* the programme to the client — only from this button, after a look */}
      {sendable ? <OfferSend draftId={draftId} again={view.stale} onSent={changed} /> : null}
      {view.partner ? <p className="text-[11.5px] font-bold text-[#557d78]">{tx("blocked_partner")}</p> : null}

      {/* the client said yes: the file goes to operations */}
      {view.canAct && awaiting ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-[#DCE9E5] pt-3">
          <label className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[#557d78]">
            {tx("confirmChannel")}
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as typeof channel)}
              className="h-8 rounded-[8px] border border-[#cfe0d9] bg-white px-2 text-[12px] font-bold text-[#185045]"
            >
              <option value="whatsapp">{tx("channel_whatsapp")}</option>
              <option value="phone">{tx("channel_phone")}</option>
              <option value="office">{tx("channel_office")}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-4 text-[12.5px] font-extrabold text-white hover:bg-[#0f4439] disabled:opacity-60"
          >
            {busy === "confirm" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {tx("confirmTitle")}
          </button>
          {view.cancel === "ok" ? (
            cancelling ? (
              <span className="flex w-full flex-wrap items-center gap-2">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={tx("cancelReason")}
                  aria-label={tx("cancelReason")}
                  className="h-9 min-w-48 flex-1 rounded-[8px] border border-[#f0c4cf] bg-white px-2.5 text-[12.5px] text-[#185045]"
                />
                <button
                  type="button"
                  onClick={() => void cancel()}
                  disabled={busy !== null || !reason.trim()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#c22850] px-3 text-[12px] font-bold text-white disabled:opacity-50"
                >
                  {busy === "cancel" ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                  {tx("cancelDo")}
                </button>
                <button type="button" onClick={() => setCancelling(false)} className="text-[12px] font-bold text-[#557d78]">
                  {tx("cancelEdit")}
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setCancelling(true)} className="ms-auto text-[11.5px] font-bold text-[#c22850] hover:underline">
                {tx("cancelFileBtn")}
              </button>
            )
          ) : null}
        </div>
      ) : null}
      {message ? <p role="status" className={`text-[12px] font-bold ${message.ok ? "text-[#0f7a52]" : "text-[#c22850]"}`}>{message.text}</p> : null}

      {view.timeline.length > 0 ? (
        <div className="border-t border-dashed border-[#DCE9E5] pt-2">
          <h4 className="mb-1 text-[11px] font-extrabold text-[#557d78]">{tx("historyTitle")}</h4>
          <ol className="space-y-0.5">
            {shown.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[11.5px]">
                <span className="tv-tnum shrink-0 font-semibold text-[#93aaa3]">{when(e.at, language)}</span>
                <span className="font-bold text-[#185045]">{line(e)}</span>
                {e.by ? <span className="text-[#7a948f]">— {e.by}</span> : null}
                {e.note && e.key === "cancelled" ? <span className="text-[#7a948f]">({e.note})</span> : null}
              </li>
            ))}
          </ol>
          {view.timeline.length > 6 ? (
            <button type="button" onClick={() => setAll(!all)} className="mt-1 text-[11px] font-bold text-[#2aa87a] hover:underline">
              {tx("historyMore")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
