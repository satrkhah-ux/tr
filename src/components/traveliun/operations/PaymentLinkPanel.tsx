"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Link2, Loader2, Send, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import { preparePaymentLink, sendPaymentLink, stablePayLink, type PaymentProvider } from "@/lib/data/payment-links";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

const secondary =
  "inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60";
const primaryOutline =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#185045] bg-white px-4 text-[13px] font-extrabold text-[#185045] hover:bg-[#f0f7f4] disabled:opacity-60";

type Prepared = { url: string; provider: PaymentProvider; mock: boolean; stable?: boolean };

/**
 * A payment link for the case: the link is created on a press, shown with an
 * editable message, and reaches the client only on «أرسله للعميل».
 * `amount` is the final price the employee chose — method fee already in it.
 */
export function PaymentLinkPanel({ operationId, amount, customerName }: { operationId: string; amount: number; customerName: string }) {
  const { t } = useTraveliunUI();
  const [pending, run] = useSafeTransition();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prepare = (provider: PaymentProvider) =>
    run(async () => {
      setError(null);
      const res = await preparePaymentLink(operationId, { provider, amount });
      if (!res.ok) return setError(t(res.error, res.params));
      setPrepared({ url: res.url, provider: res.provider, mock: res.mock });
      setBody(t("pay.message", { name: customerName, amount: res.amount.toLocaleString("en-US"), currency: res.currency, url: res.url }));
      setSent(false);
    });

  // «رابط الدفع الثابت»: our /pay link with this amount signed — the invoice is made when the client presses «ادفع الآن»
  const prepareStable = (provider: PaymentProvider) =>
    run(async () => {
      setError(null);
      const res = await stablePayLink(operationId, amount, provider);
      if (!res.ok) return setError(t(res.error, res.params));
      setPrepared({ url: res.url, provider, mock: false, stable: true });
      setBody(t("pay.message", { name: customerName, amount: res.amount.toLocaleString("en-US"), currency: res.currency, url: res.url }));
      setSent(false);
    });

  const send = () =>
    run(async () => {
      if (!prepared) return;
      setError(null);
      const res = await sendPaymentLink(operationId, { url: prepared.url, body });
      if (!res.ok) return setError(t(res.error, res.params));
      setSent(true);
    });

  if (!prepared) {
    return (
      <span className="inline-flex flex-col gap-1">
        <span className="flex flex-wrap gap-2">
          <button type="button" disabled={pending || !(amount > 0)} onClick={() => prepare("myfatoorah")} className={primaryOutline}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            {t("pay.button.myfatoorah")}
          </button>
          <button type="button" disabled={pending || !(amount > 0)} onClick={() => prepare("tamara")} className={primaryOutline}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            {t("pay.button.tamara")}
          </button>
          <button type="button" disabled={pending || !(amount > 0)} onClick={() => prepareStable("myfatoorah")} title={t("pay.stable.hint")} className={primaryOutline}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            {t("pay.button.stable")}
          </button>
          <button type="button" disabled={pending || !(amount > 0)} onClick={() => prepareStable("tamara")} title={t("pay.stable.hint")} className={primaryOutline}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            {t("pay.button.stableTamara")}
          </button>
        </span>
        {error ? <span className="text-[11.5px] font-bold text-[#c22850]">{error}</span> : null}
      </span>
    );
  }

  return (
    <section className="w-full rounded-[12px] border border-[#d6eadf] bg-[#f8fbf9] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-[13px] font-extrabold text-[#0f3d38]">
          {t(prepared.stable ? (prepared.provider === "tamara" ? "pay.button.stableTamara" : "pay.button.stable") : prepared.provider === "tamara" ? "pay.button.tamara" : "pay.button.myfatoorah")}
          {prepared.mock ? (
            <span className="rounded-full bg-[#fff4e0] px-2 py-0.5 text-[10.5px] font-bold text-[#a8650a]">{t("pay.mock")}</span>
          ) : null}
          {sent ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0f7a52]">
              <Check className="size-3.5" />
              {t("pay.sent")}
            </span>
          ) : null}
        </h3>
        <button type="button" onClick={() => setPrepared(null)} aria-label={t("close")} className="rounded-md p-1.5 text-[#557d78] hover:bg-[#eef4f1]">
          <X className="size-4" />
        </button>
      </div>
      <DirText dir="ltr" className="mb-2 break-all text-[12px] font-semibold text-[#2a7d66]">
        {prepared.url}
      </DirText>
      {sent ? null : (
        <>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            dir="auto"
            className="mb-2 block w-full rounded-[9px] border border-[#dbe6e1] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-[#0f3d38] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !body.trim()}
              onClick={send}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-45"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {t("pay.send")}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(body);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}
              className={secondary}
            >
              <Copy className="size-3.5" />
              {copied ? t("copied") : t("ops.dispatch.copy")}
            </button>
            <a href={prepared.url} target="_blank" rel="noopener noreferrer" className={secondary}>
              <ExternalLink className="size-3.5" />
              {t("pay.open")}
            </a>
          </div>
        </>
      )}
      {error ? <p className="mt-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
    </section>
  );
}
