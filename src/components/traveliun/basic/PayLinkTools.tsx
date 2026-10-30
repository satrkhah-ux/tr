"use client";

import { useState } from "react";
import { Check, Copy, CreditCard, Loader2, Send } from "lucide-react";
import { basicPayLink, sendBasicPayLink } from "@/lib/data/file-status";
import type { PayVia } from "@/lib/payments/pay-now-rules";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

const outline =
  "inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#185045] bg-white px-3 text-[12px] font-extrabold text-[#185045] hover:bg-[#f0f7f4] disabled:opacity-60";

/**
 * «رابط الدفع» on an issued file (the owner, 2026-10-29): our stable /pay/<serial> — copied, or put in a message
 * the employee reviews and sends with a press. An optional amount (a deposit, an instalment) is signed on the server.
 * MyFatoorah or Tamara — the link takes the client to the gateway chosen here.
 */
export function PayLinkTools({ draftId }: { draftId: string }) {
  const { t } = useTraveliunUI();
  const [pending, run] = useSafeTransition();
  const [via, setVia] = useState<PayVia>("myfatoorah");
  const [amount, setAmount] = useState("");
  const [body, setBody] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = (then: (url: string, value: number) => void) =>
    run(async () => {
      setError(null);
      setSent(false);
      const res = await basicPayLink(draftId, amount.trim() ? Number(amount) : null, via);
      if (!res.ok) return setError(t(res.error, res.params));
      then(res.url, res.amount);
    });

  const copy = () =>
    link((url) => {
      void navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });

  const prepare = () => link((url, value) => setBody(t("pay.link.message", { amount: value.toLocaleString("en-US"), url })));

  const send = () =>
    run(async () => {
      if (!body) return;
      setError(null);
      const res = await sendBasicPayLink(draftId, body);
      if (!res.ok) return setError(t(res.error, res.params));
      setSent(true);
      setBody(null);
    });

  return (
    <div className="rounded-[10px] border border-[#e3ece8] bg-[#f8fbf9] p-2.5">
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold text-[#103f37]">
        <CreditCard className="size-3.5" />
        {t("pay.link.title")}
      </p>
      <div className="mb-2 flex gap-1.5" role="radiogroup" aria-label={t("pay.link.title")}>
        {(["myfatoorah", "tamara"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={via === v}
            onClick={() => {
              setVia(v);
              setBody(null);
            }}
            className={`h-8 rounded-full border px-3 text-[11.5px] font-extrabold ${via === v ? "border-[#185045] bg-[#185045] text-white" : "border-[#dbe6e1] bg-white text-[#185045]"}`}
          >
            {t(v === "tamara" ? "pay.method.tamara" : "pay.link.viaMyFatoorah")}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder={t("pay.link.amount")}
          aria-label={t("pay.link.amount")}
          dir="ltr"
          className="h-9 min-w-0 flex-1 basis-40 rounded-[9px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
        />
        <button type="button" disabled={pending} onClick={copy} className={outline}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? t("copied") : t("pay.link.copy")}
        </button>
        <button type="button" disabled={pending} onClick={prepare} className={outline}>
          <Send className="size-3.5" />
          {t("pay.link.send")}
        </button>
        {sent ? (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-[#0f7a52]">
            <Check className="size-3.5" />
            {t("pay.sent")}
          </span>
        ) : null}
      </div>
      {body !== null ? (
        <div className="mt-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            dir="auto"
            className="mb-2 block w-full rounded-[9px] border border-[#dbe6e1] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-[#0f3d38] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
          />
          <button
            type="button"
            disabled={pending || !body.trim()}
            onClick={send}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-45"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {t("pay.send")}
          </button>
        </div>
      ) : null}
      {error ? <p className="mt-1.5 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
    </div>
  );
}
