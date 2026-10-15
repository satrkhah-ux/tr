"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Loader2, Send, UserRound } from "lucide-react";
import { DirText } from "@/components/DirText";
import { draftClientMessage, sendClientMessageNow, type ClientDraft } from "@/lib/data/operation-client-send";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

/**
 * «أرسل للعميل» (operations order 6), like «أرسل للسائق»: the file's hotels,
 * confirmation numbers, drives, trip link and balance drafted into one
 * message, to the mobile on the file — read, edited, then sent through Teletel.
 * Never drawn for a partner's file (the server refuses it too).
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

  function prepare() {
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const res = await draftClientMessage(operationId);
      if (!res.ok) setError(t(res.error));
      else {
        setDraft(res.draft);
        setBody(res.draft.body);
      }
    });
  }

  function send() {
    startTransition(async () => {
      setError(null);
      const res = await sendClientMessageNow({ operation_id: operationId, body });
      if (!res.ok) setError(t(res.error));
      else {
        setDraft(null);
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
      {notice ? <p className="mt-1.5 text-[11.5px] font-bold text-[#0f7a52]">{notice}</p> : null}
      {error ? <p className="mt-1.5 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
      {draft ? (
        <div className="mt-2 rounded-[10px] border border-[#d6eadf] bg-white p-3">
          <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-[#0f7a52]">
            <UserRound className="size-3.5" />
            {draft.to_name || "—"}
            <DirText dir="ltr" className="font-semibold text-[#93aaa3]">{draft.to_phone}</DirText>
          </p>
          <p className="mb-2 text-[11px] font-semibold text-[#93aaa3]">{t("ops.toClient.review")}</p>
          {draft.blocked ? <p className="mb-2 text-[11.5px] font-bold text-[#a86a10]">{t(draft.blocked)}</p> : null}
          {/* editable on purpose — what is kept is what actually went out */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            dir="auto"
            className="mb-2 block w-full rounded-[9px] border border-[#dbe6e1] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-[#0f3d38] outline-none focus:border-[#2aa87a]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !body.trim() || draft.blocked !== null}
              onClick={send}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-45"
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
