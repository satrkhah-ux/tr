"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BriefcaseBusiness, CheckCircle2, Copy, Eye, FileText, History, Loader2, XCircle } from "lucide-react";
import { cancelFile, confirmFromBasic, getFileStatus, type FileError, type FileStatusView } from "@/lib/data/file-status";
import { AWAITING_CLIENT, SENDABLE, type FileState, type TimelineEntry } from "@/lib/offer/file-state";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { OfferSend } from "../OfferSend";
import { CoverChoice } from "../CoverChoice";
import type { CoverStyle } from "@/components/offer-doc/cover-image";
import { TripLinkSend } from "./TripLinkSend";
import { PayLinkTools } from "./PayLinkTools";
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
/**
 * What was loaded, by draft — a second open of the same file is immediate (and
 * refreshed behind it), and the files list loads it as the mouse comes over the
 * button. One tab's memory: nothing here outlives the page.
 */
const loaded = new Map<string, FileStatusView>();
const inFlight = new Map<string, Promise<FileStatusView | null>>();

function fetchStatus(draftId: string): Promise<FileStatusView | null> {
  const running = inFlight.get(draftId);
  if (running) return running;
  const p = getFileStatus(draftId)
    .then((r) => {
      if (r.ok) loaded.set(draftId, r);
      return r.ok ? r : null;
    })
    .finally(() => inFlight.delete(draftId));
  inFlight.set(draftId, p);
  return p;
}

/** start loading a file's status before its panel opens (hover / focus on the button). */
export function prefetchFileStatus(draftId: string): void {
  if (!loaded.has(draftId)) void fetchStatus(draftId);
}

export function BasicFileStatus({
  draftId,
  serial,
  variant,
  refresh = 0,
  onChanged,
  known,
  extras,
  autoOpen = false,
}: {
  draftId: string;
  serial: string;
  variant: "chip" | "panel";
  refresh?: number;
  onChanged?: () => void;
  /** what the files list already knows — shown at once while the rest loads */
  known?: { state: FileState; version: number | null; sentVersion: number | null; stale: boolean; operationId: string | null };
  /** the editor's own parts of the issued section: «إصدار نسخة محدّثة», «سجل النسخ», the hotel-data line */
  extras?: { reissue?: ReactNode; versions?: ReactNode; guard?: ReactNode };
  /** just issued from the editor: scroll this panel into view (the client document is opened by the editor) */
  autoOpen?: boolean;
}) {
  const tx = useBasicLabels();
  const { t, language } = useTraveliunUI();
  const [view, setView] = useState<FileStatusView | null>(() => loaded.get(draftId) ?? null);
  const [tick, setTick] = useState(0);
  const [channel, setChannel] = useState<"whatsapp" | "phone" | "office">("whatsapp");
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [all, setAll] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [copied, setCopied] = useState(false);
  // «غلاف الملف»: what the employee picked here (the server keeps it on the offer); until then the loaded value
  const [coverPick, setCoverPick] = useState<CoverStyle | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const shownView = view !== null;
  useEffect(() => {
    if (autoOpen && shownView) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [autoOpen, shownView]);

  useEffect(() => {
    let live = true;
    // after an action the stored copy is stale: load again
    if (tick > 0 || refresh > 0) loaded.delete(draftId);
    void fetchStatus(draftId).then((r) => {
      if (live) setView(r);
    });
    return () => {
      live = false;
    };
  }, [draftId, serial, refresh, tick]);

  if (!view) {
    // the list's row already says where the file stands: that at once, the rest when it comes
    if (variant !== "panel" || !known) return null;
    return (
      <div className="tv-card mt-3 space-y-3 rounded-[12px] border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <FileStateChip state={known.state} version={known.version} sentVersion={known.sentVersion} stale={known.stale} />
          {known.operationId ? (
            <Link
              href={`/operations/${known.operationId}`}
              className="ms-auto inline-flex h-8 max-sm:h-10 items-center gap-1.5 rounded-[8px] border border-[#cfe0d9] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
            >
              <BriefcaseBusiness className="size-3.5" />
              {tx("openOperations")}
            </Link>
          ) : null}
        </div>
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#557d78]">
          <Loader2 className="size-3.5 animate-spin" /> {tx("statusLoading")}
        </p>
      </div>
    );
  }
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
      // stay here: the next step is the bookings' link to the client (step ③), the case one click away;
      // a partner's client hears from the partner, and without the case's door the team takes it on
      setMessage({ text: r.canOpen && !view?.partner ? tx("confirmDoneNext") : tx("confirmDoneTeam"), ok: true });
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

  // the file's step decides the one filled button: the send until it has gone out, the confirmation after
  const sentOnce = view.sentVersion != null;
  // one current step: ① and ② are behind once the programme went (or the client said yes), ③ is the yes and then its link
  const confirmed = !awaiting;
  const sentNow = sentOnce && !view.stale;
  const linkHere = Boolean(view.operationId) && view.canAct && !view.partner;
  const step2: "done" | "now" | "off" = view.partner || !view.canAct ? "off" : sentNow || (confirmed && !view.stale) ? "done" : "now";
  const step2Hint = view.partner
    ? tx("blocked_partner")
    : !view.canAct
      ? tx("colleagueFile")
      : sentNow
        ? tx("stepSendDone")
        : confirmed && !view.stale
          ? tx("stepSendAfterConfirm")
          : tx("stepSendHint");
  const step3Hint = awaiting
    ? view.canAct
      ? tx("stepConfirmHint")
      : tx("colleagueFile")
    : view.partner
      ? tx("partnerFollows")
      : linkHere
        ? tx("stepConfirmedHint")
        : tx("confirmDoneTeam");
  const link = `/client-offer/${serial}`;
  const quiet = "inline-flex items-center gap-1 text-[12px] font-bold text-[#185045] hover:underline";

  return (
    <div ref={panelRef} className="tv-card mt-3 scroll-mt-20 space-y-3 rounded-[12px] border p-3">
      {/* ① where the file stands, one line */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="tv-tnum text-[12.5px] font-extrabold text-[#103f37]" dir="ltr">
          {serial}
        </span>
        <FileStateChip state={view.state} version={view.version} sentVersion={view.sentVersion} stale={view.stale} />
        {view.canOpenCase && view.operationId ? (
          <Link
            href={`/operations/${view.operationId}`}
            className="ms-auto inline-flex h-8 max-sm:h-10 items-center gap-1.5 rounded-[8px] border border-[#cfe0d9] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
          >
            <BriefcaseBusiness className="size-3.5" />
            {tx("openOperations")}
          </Link>
        ) : null}
      </div>

      {/* ② three numbered steps, each with what it is for (the owner, 2026-10-22: «تظهر الخيارات عشوائية ولا يعرف الموظف ماذا يختار») */}
      {view.state === "cancelled" ? null : (
      <ol className="space-y-2">
        <Step n={1} title={tx("stepReview")} hint={tx("stepReviewHint")} status={step2 === "now" ? "now" : "done"}>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[9px] border border-[#185045] bg-white px-3.5 text-[12.5px] font-extrabold text-[#185045] hover:bg-[#f0f7f4] max-sm:flex-1"
            >
              <Eye className="size-4" />
              {tx("reviewOffer")}
            </a>
            <a
              href={`/offer/${serial}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center gap-1 rounded-[9px] border border-[#dbe6e1] px-3 text-[12px] font-bold text-[#557d78] hover:text-[#185045]"
            >
              <FileText className="size-3.5" />
              PDF
            </a>
          </div>
          {view.canAct && !view.partner ? (
            <div className="mt-2">
              <CoverChoice
                draftId={draftId}
                serial={serial}
                value={coverPick ?? view.cover}
                onChange={(c) => {
                  setCoverPick(c);
                  loaded.set(draftId, { ...view, cover: c });
                }}
                preview
              />
            </div>
          ) : null}
        </Step>
        <Step
          n={2}
          title={tx("stepSend")}
          hint={step2Hint}
          status={step2}
        >
          {/* the filled button is the current step's only: framed once the file is past it */}
          {sendable ? <OfferSend draftId={draftId} again={view.stale} onSent={changed} filled={step2 === "now"} cover={coverPick ?? view.cover} onCover={(c) => setCoverPick(c)} /> : null}
          {/* «رابط الدفع» (the owner, 2026-10-29): our stable /pay link — copied, or reviewed and sent */}
          {view.canAct && !view.partner ? <div className="mt-2"><PayLinkTools draftId={draftId} /></div> : null}
        </Step>
        <Step
          n={3}
          title={awaiting ? tx("stepConfirm") : tx("stepConfirmed")}
          hint={step3Hint}
          status={awaiting ? (!view.canAct ? "off" : sentNow ? "now" : "next") : linkHere ? "now" : "done"}
        >
          {view.canAct && awaiting ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[#557d78]">
                {tx("confirmChannel")}
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as typeof channel)}
                  className="tv-field h-9 rounded-[8px] border px-2 text-[12px] font-bold"
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
                className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-[9px] px-4 text-[12.5px] font-extrabold disabled:opacity-60 max-sm:flex-1 max-sm:min-h-10 ${
                  sentOnce && !view.stale ? "bg-[#185045] text-white hover:bg-[#0f4439]" : "border border-[#185045] bg-white text-[#185045] hover:bg-[#f0f7f4]"
                }`}
              >
                {busy === "confirm" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                {tx("confirmTitle")}
              </button>
            </div>
          ) : linkHere && view.operationId ? (
            <TripLinkSend operationId={view.operationId} />
          ) : null}
        </Step>
      </ol>
      )}
      {message ? <p role="status" className={`text-[12px] font-bold ${message.ok ? "text-[#0f7a52]" : "text-[#c22850]"}`}>{message.text}</p> : null}

      {/* a warning that blocks nothing: one line under the steps */}
      {extras?.guard}

      {/* ③ the rest, small, under its name */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-dashed border-[#DCE9E5] pt-2">
        <span className="w-full text-[10.5px] font-extrabold text-tv-text-faint sm:w-auto">{tx("otherTools")}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(`${window.location.origin}${link}`).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            });
          }}
          className={quiet}
        >
          <Copy className="size-3.5" />
          {copied ? tx("copiedClientLink") : tx("copyClientLink")}
        </button>
        {extras?.reissue}
        {extras?.versions ? (
          <button type="button" onClick={() => setShowVersions((v) => !v)} aria-expanded={showVersions} className={quiet}>
            <History className="size-3.5" />
            {tx("versionsHistory")}
          </button>
        ) : null}
        {view.timeline.length > 0 ? (
          <button type="button" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} className={quiet}>
            <History className="size-3.5" />
            {tx("historyTitle")}
          </button>
        ) : null}
        {view.canAct && awaiting && view.cancel === "ok" && !cancelling ? (
          <button type="button" onClick={() => setCancelling(true)} className="ms-auto text-[12px] font-bold text-[#c22850] hover:underline">
            {tx("cancelFileBtn")}
          </button>
        ) : null}
      </div>

      {cancelling ? (
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
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#c22850] px-3 text-[12px] font-bold text-white disabled:opacity-50 max-sm:min-h-10"
          >
            {busy === "cancel" ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
            {tx("cancelDo")}
          </button>
          <button type="button" onClick={() => setCancelling(false)} className="text-[12px] font-bold text-[#557d78]">
            {tx("cancelEdit")}
          </button>
        </span>
      ) : null}

      {showVersions ? extras?.versions : null}

      {showHistory && view.timeline.length > 0 ? (
        <div>
          <ol className="space-y-0.5">
            {shown.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[11.5px]">
                <span className="tv-tnum shrink-0 font-semibold text-tv-text-faint">{when(e.at, language)}</span>
                <span className="font-bold text-[#185045]">{line(e)}</span>
                {e.by ? <span className="text-tv-text-faint">— {e.by}</span> : null}
                {e.note && e.key === "cancelled" ? <span className="text-tv-text-faint">({e.note})</span> : null}
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

/**
 * One numbered step of the issued section: its number (a tick once done), what
 * it is for in a line, and its controls. «now» is the step the file is on.
 */
function Step({ n, title, hint, status, children }: { n: number; title: string; hint: string; status: "done" | "now" | "next" | "off"; children?: ReactNode }) {
  const badge =
    status === "done" ? "bg-[#0f7a52] text-white" : status === "now" ? "bg-[#185045] text-white" : "bg-[#eef3f1] text-tv-text-faint";
  return (
    <li className={`space-y-2 rounded-[11px] border p-2.5 max-sm:p-2 ${status === "now" ? "border-[#b9d6cb] bg-[#f7fbf9]" : "border-[#edf3f0]"}`}>
      <div className="flex gap-2.5">
        <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[12.5px] font-extrabold ${badge}`}>{status === "done" ? "✓" : n}</span>
        <div className="min-w-0">
          <p className={`text-[13px] font-extrabold ${status === "next" || status === "off" ? "text-tv-text-faint" : "text-[#103f37]"}`}>{title}</p>
          <p className="text-[11.5px] font-semibold text-tv-text-faint">{hint}</p>
        </div>
      </div>
      {/* the controls take the card's full width — on a phone the review box keeps its room */}
      {children ? <div className="sm:ps-9">{children}</div> : null}
    </li>
  );
}
