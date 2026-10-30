"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, Send, UserRound } from "lucide-react";
import { DirText } from "@/components/DirText";
import { draftClientMessage, listPreparedMessages, sendClientMessageNow, type ClientDraft, type PreparedList } from "@/lib/data/operation-client-send";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

/**
 * «أرسل للعميل» (operations order 6), like «أرسل للسائق»: the file's hotels,
 * confirmation numbers, drives, trip link and balance drafted into one
 * message, to the mobile on the file — read, edited, then sent through Teletel.
 * Never drawn for a partner's file (the server refuses it too).
 *
 * Under it, «رسائل جاهزة للإرسال» (the owner, 2026-10-17): the trip link with
 * our booking numbers once the client confirmed, a flight's ticket, a hotel's
 * own confirmation and voucher — prepared, never sent until the agent presses
 * «إرسال» — and, in red, a hotel still on our number alone the day before travel.
 */
export function ClientSend({ operationId }: { operationId: string }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useSafeTransition();
  const [draft, setDraft] = useState<ClientDraft | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [list, setList] = useState<PreparedList | null>(null);
  /** the prepared update being reviewed; null for the booking summary. */
  const [key, setKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    let live = true;
    listPreparedMessages(operationId)
      .then((res) => live && setList(res.ok ? res.list : null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [operationId, loaded]);

  function prepare() {
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const res = await draftClientMessage(operationId);
      if (!res.ok) setError(t(res.error));
      else {
        setKey(null);
        setDraft(res.draft);
        setBody(res.draft.body);
      }
    });
  }

  function send() {
    startTransition(async () => {
      setError(null);
      const res = await sendClientMessageNow({ operation_id: operationId, body, ...(key ? { key } : {}) });
      if (!res.ok) setError(t(res.error));
      else {
        setDraft(null);
        setLoaded((n) => n + 1);
        setNotice(t(res.result === "sent" ? "ops.toClient.sent" : "ops.toClient.window"));
        router.refresh();
      }
    });
  }

  return (
    <div className="w-full">
      <button
        type="button"
        disabled={pending}
        onClick={() => (draft ? setDraft(null) : prepare())}
        aria-expanded={draft !== null}
        className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
      >
        {pending && !draft ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        {t("ops.toClient.send")}
      </button>
      {list && list.risks.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {list.risks.map((hotel) => (
            <li key={hotel} className="flex items-start gap-1.5 rounded-[9px] border border-[#f3c2cf] bg-[#fdecf0] px-2.5 py-1.5 text-[11.5px] font-bold text-[#c22850]">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {t("trip.status.hotelAtRisk", { hotel })}
            </li>
          ))}
        </ul>
      ) : null}
      {list && list.items.length > 0 ? (
        <div className="mt-2 rounded-[10px] border border-[#d6eadf] bg-[#f6fbf8] p-2.5">
          <p className="text-[12px] font-extrabold text-[#185045]">{t("trip.status.prepared")}</p>
          <p className="mb-1.5 text-[11px] font-semibold text-tv-text-faint">{t("trip.status.preparedHint")}</p>
          <ul className="space-y-1">
            {list.items.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center justify-between gap-2 text-[12px] font-bold text-[#0f3d38]">
                <span className="min-w-0 break-words">{m.label}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setKey(m.key);
                    setDraft({ to_name: list.to_name, to_phone: list.to_phone, body: m.body, blocked: list.blocked });
                    setBody(m.body);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#cfe3da] bg-white px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#eef6f2] disabled:opacity-60"
                >
                  <Send className="size-3" />
                  {t("trip.status.review")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {notice ? <p className="mt-1.5 text-[11.5px] font-bold text-[#0f7a52]">{notice}</p> : null}
      {error ? <p className="mt-1.5 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
      {draft ? (
        <div className="mt-2 rounded-[10px] border border-[#d6eadf] bg-white p-3">
          <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-[#0f7a52]">
            <UserRound className="size-3.5" />
            {draft.to_name || "—"}
            <DirText dir="ltr" className="font-semibold text-tv-text-faint">{draft.to_phone}</DirText>
          </p>
          <p className="mb-2 text-[11px] font-semibold text-tv-text-faint">{t("ops.toClient.review")}</p>
          {draft.blocked ? <p className="mb-2 text-[11.5px] font-bold text-[#a86a10]">{t(draft.blocked)}</p> : null}
          {/* editable on purpose — what is kept is what actually went out */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            dir="auto"
            className="mb-2 block w-full rounded-[9px] border border-[#dbe6e1] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-[#0f3d38] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !body.trim() || draft.blocked !== null}
              onClick={send}
              className="tv-btn-primary inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3.5 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-45 max-sm:min-h-10"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {t("ops.dispatch.send")}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(body);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? t("copied") : t("ops.dispatch.copy")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
