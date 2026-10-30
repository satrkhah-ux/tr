"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, FileText, Loader2, Send, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import { prepareOfferMessage, sendOfferMessage, type FileError, type OfferMessageDraft } from "@/lib/data/file-status";
import type { CoverStyle } from "@/components/offer-doc/cover-image";
import { CoverChoice } from "./CoverChoice";
import { useBasicLabels } from "./basic/labels";

const ERR: Partial<Record<FileError, "fileErr_forbidden" | "fileErr_cancelled" | "fileErr_empty" | "fileErr_partner">> = {
  forbidden: "fileErr_forbidden",
  cancelled: "fileErr_cancelled",
  empty: "fileErr_empty",
  partner: "fileErr_partner",
};
const SAID = {
  sent: "waSent",
  template: "waTemplate",
  window: "waWindow",
  no_phone: "waNoPhone",
  unreachable: "waUnreachable",
  off: "blocked_off",
  not_allowed: "blocked_not_allowed",
  partner: "blocked_partner",
  manual: "sendManualDone",
} as const;
/** Why the system will not send it, told before the employee writes a word. */
const BLOCKED = {
  no_phone: "blocked_no_phone",
  off: "blocked_off",
  not_allowed: "blocked_not_allowed",
  partner: "blocked_partner",
  unreachable: "waUnreachable",
} as const;

/**
 * «أرسل إلى العميل عبر واتساب» — the issued programme goes to the client only
 * from here (the owner, 2026-10-17): the message is prepared, the employee
 * opens the client's link and PDF, edits the text if needed, and sends — or
 * records that they sent it themselves. Basic's finish step and the full
 * generator's preview use the same panel.
 */
export function OfferSend({
  draftId,
  again = false,
  onSent,
  className = "",
  filled = true,
  cover: coverProp,
  onCover,
}: {
  draftId: string;
  again?: boolean;
  onSent?: () => void;
  /** "contents" sets the button in its parent's row, the review taking the full width under it */
  className?: string;
  /** the file's current step is the filled button; otherwise a framed one */
  filled?: boolean;
  /** the PDF cover when the parent shows the choice too (BasicFileStatus keeps it); otherwise the panel keeps its own */
  cover?: CoverStyle;
  onCover?: (cover: CoverStyle) => void;
}) {
  const tx = useBasicLabels();
  const [draft, setDraft] = useState<OfferMessageDraft | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"prepare" | "send" | "manual" | null>(null);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // the first page of the PDF — «أساسي» or «فني»: the employee's choice (kept on the offer), said nowhere in the client's PDF or link
  const [ownCover, setOwnCover] = useState<CoverStyle>("basic");
  const cover = coverProp ?? ownCover;
  const setCover = (c: CoverStyle) => {
    setOwnCover(c);
    onCover?.(c);
  };

  const fail = (e: FileError) => setError(tx(ERR[e] ?? "fileErr_failed"));

  async function open() {
    setBusy("prepare");
    setError(null);
    setSaid(null);
    try {
      const r = await prepareOfferMessage(draftId);
      if (!r.ok) return fail(r.error);
      setDraft(r);
      setBody(r.body);
      setOwnCover(r.cover);
    } catch {
      fail("failed");
    } finally {
      setBusy(null);
    }
  }

  async function send(manual: boolean) {
    setBusy(manual ? "manual" : "send");
    setError(null);
    try {
      const r = await sendOfferMessage(draftId, body, manual);
      if (!r.ok) return fail(r.error);
      setSaid({ text: tx(SAID[r.result]), ok: r.result === "sent" || r.result === "template" || r.result === "manual" });
      // a send or a note left in the client's thread: the status moves on and the panel closes
      if (r.result === "sent" || r.result === "template" || r.result === "manual" || r.result === "window") {
        setDraft(null);
        onSent?.();
      }
    } catch {
      fail("failed");
    } finally {
      setBusy(null);
    }
  }

  const blockedText = draft?.blocked && draft.blocked in BLOCKED ? tx(BLOCKED[draft.blocked as keyof typeof BLOCKED]) : null;
  const canSend = Boolean(draft) && !draft?.blocked && body.trim().length > 0 && busy === null;

  return (
    <div className={className}>
      {draft ? (
        <div className="w-full basis-full space-y-2 rounded-[12px] border border-[#cfe0d9] bg-[#f7fbf9] p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11.5px] font-bold text-[#557d78]">{tx("sendReview")}</p>
            <button type="button" onClick={() => setDraft(null)} aria-label={tx("cancelEdit")} className="rounded-[7px] p-1 text-tv-text-faint hover:bg-white">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold text-[#185045]">
            <span>
              {tx("sendTo")}: {draft.toName || "—"}
              {draft.toPhone ? (
                <>
                  {" · "}
                  <DirText dir="ltr" className="tv-tnum">{draft.toPhone}</DirText>
                </>
              ) : null}
            </span>
            <a href={draft.link} target="_blank" rel="noopener noreferrer" className="ms-auto inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#cfe0d9] bg-white px-2.5 text-[11.5px] hover:bg-[#f0f7f4]">
              <ExternalLink className="size-3.5" />
              {tx("previewLink")}
            </a>
            <a href={cover === "designed" ? `${draft.pdf}?c=d` : draft.pdf} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#cfe0d9] bg-white px-2.5 text-[11.5px] hover:bg-[#f0f7f4]">
              <FileText className="size-3.5" />
              {tx("previewPdf")}
            </a>
          </div>
          <CoverChoice draftId={draftId} serial={draft.serial} value={cover} onChange={setCover} />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.min(Math.max(body.split("\n").length + 1, 6), 14)}
            aria-label={tx("sendTitle")}
            className="w-full rounded-[10px] border border-[#dbe6e1] bg-white p-2.5 text-[13px] leading-6 text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
          />
          {blockedText ? (
            <p className="text-[11.5px] font-bold text-[#a86a10]">{blockedText}</p>
          ) : (
            <p className="text-[11px] font-semibold text-tv-text-faint">{tx("sendTemplateHint")}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void send(false)}
              disabled={!canSend}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-4 text-[12.5px] font-extrabold text-white hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {tx("sendNow")}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(body).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                });
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#cfe0d9] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? tx("sendCopied") : tx("sendCopy")}
            </button>
            <button
              type="button"
              onClick={() => void send(true)}
              disabled={busy !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[12px] font-bold text-[#557d78] hover:text-[#185045] disabled:opacity-50"
            >
              {busy === "manual" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {tx("sendManual")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy !== null}
          className={`inline-flex h-9 items-center gap-2 rounded-[9px] px-3.5 text-[12.5px] font-extrabold disabled:opacity-60 ${filled ? "bg-[#1f8a5b] text-white hover:bg-[#18744c]" : "border border-[#1f8a5b] bg-white text-[#1f8a5b] hover:bg-[#eef8f3]"}`}
        >
          {busy === "prepare" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {again ? tx("sendAgain") : tx("sendTitle")}
        </button>
      )}
      {error ? <p role="alert" className="mt-2 basis-full text-[12px] font-bold text-[#c22850]">{error}</p> : null}
      {said ? <p role="status" className={`mt-2 basis-full text-[12px] font-bold ${said.ok ? "text-[#0f7a52]" : "text-[#a86a10]"}`}>{said.text}</p> : null}
    </div>
  );
}
