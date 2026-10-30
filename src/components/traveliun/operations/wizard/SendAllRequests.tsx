"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Loader2, Send, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import { sendBookingRequest } from "@/lib/data/operation-assign";
import { draftAllRequests, type AllRequestDraft } from "@/lib/data/send-all-requests";
import { waNumber } from "@/lib/operations/drivers";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { useSafeTransition } from "../../useSafeTransition";

const secondary =
  "inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60";

/**
 * «أرسل كل الطلبات» (the owner, 2026-10-26): one press gathers every unasked
 * supplier of the case into prepared messages — one per supplier, reviewed,
 * then each sent on its own press. Nothing goes out without the clerk's hand.
 */
export function SendAllRequests({ operationId }: { operationId: string }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [drafts, setDrafts] = useState<AllRequestDraft[] | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  function prepare() {
    run(async () => {
      setError(null);
      const res = await draftAllRequests(operationId);
      if (!res.ok) return setError(t(res.error));
      setDrafts(res.drafts);
      setBodies(Object.fromEntries(res.drafts.map((d) => [d.supplierId, d.draft.body])));
      setDone(new Set());
    });
  }

  const send = (d: AllRequestDraft, channel: "whatsapp" | "manual") =>
    run(async () => {
      setError(null);
      const res = await sendBookingRequest({
        booking_id: d.bookingIds[0],
        also_ids: d.bookingIds.slice(1),
        operation_id: operationId,
        channel,
        to_label: d.draft.to_label,
        to_phone: d.draft.to_phone,
        body: bodies[d.supplierId] ?? d.draft.body,
      });
      if (!res.ok) return setError(t(res.error));
      setDone((prev) => new Set(prev).add(d.supplierId));
      router.refresh();
    });

  if (drafts === null) {
    return (
      <span className="inline-flex flex-col gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={prepare}
          className="tv-btn-secondary inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border px-4 text-[13px] font-extrabold disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {t("wz.sendAll.button")}
        </button>
        {error ? <span className="text-[11.5px] font-bold text-[#c22850]">{error}</span> : null}
      </span>
    );
  }

  return (
    <section className="w-full rounded-[12px] border border-[#d6eadf] bg-[#f8fbf9] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-extrabold text-[#0f3d38]">
          {t("wz.sendAll.title", { n: String(drafts.length) })}
        </h3>
        <button type="button" onClick={() => setDrafts(null)} aria-label={t("close")} className="rounded-md p-1.5 text-[#557d78] hover:bg-[#eef4f1]">
          <X className="size-4" />
        </button>
      </div>
      {drafts.length === 0 ? <p className="text-[12.5px] font-semibold text-tv-text-faint">{t("wz.sendAll.none")}</p> : null}
      <div className="space-y-3">
        {drafts.map((d) => (
          <article key={d.supplierId} className={`rounded-[10px] border bg-white p-3 ${done.has(d.supplierId) ? "border-[#bfe5d4]" : "border-[#e2ebe7]"}`}>
            <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] font-extrabold text-[#0f3d38]">
              {d.draft.to_label}
              {d.draft.to_phone ? <DirText dir="ltr" className="font-semibold text-tv-text-faint">{d.draft.to_phone}</DirText> : null}
              <span className="tv-tnum rounded-full bg-[#eef5f2] px-2 py-0.5 text-[10.5px] font-bold text-[#2a7d66]">{t("wz.sendAll.count", { n: String(d.bookingIds.length) })}</span>
              {done.has(d.supplierId) ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0f7a52]">
                  <Check className="size-3.5" />
                  {t("wz.sendAll.sent")}
                </span>
              ) : null}
            </p>
            {done.has(d.supplierId) ? null : (
              <>
                <textarea
                  value={bodies[d.supplierId] ?? ""}
                  onChange={(e) => setBodies((prev) => ({ ...prev, [d.supplierId]: e.target.value }))}
                  rows={8}
                  dir="auto"
                  className="mb-2 block w-full rounded-[9px] border border-[#dbe6e1] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-[#0f3d38] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending || !d.draft.canSendWhatsapp}
                    title={d.draft.canSendWhatsapp ? undefined : t("ops.err.noConversation")}
                    onClick={() => send(d, "whatsapp")}
                    className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-45"
                  >
                    <Send className="size-3.5" />
                    {t("ops.request.sendWhatsapp")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(bodies[d.supplierId] ?? "");
                      setCopied(d.supplierId);
                      window.setTimeout(() => setCopied(""), 1600);
                    }}
                    className={secondary}
                  >
                    <Copy className="size-3.5" />
                    {copied === d.supplierId ? t("copied") : t("ops.dispatch.copy")}
                  </button>
                  {d.draft.to_phone ? (
                    <a
                      href={`https://wa.me/${waNumber(d.draft.to_phone)}?text=${encodeURIComponent(bodies[d.supplierId] ?? "")}`}
                      target="_blank"
                      rel="noopener"
                      className={secondary}
                    >
                      {t("ops.dispatch.openWhatsapp")}
                    </a>
                  ) : null}
                  <button type="button" disabled={pending} onClick={() => send(d, "manual")} className={secondary}>
                    <Check className="size-3.5" />
                    {t("ops.request.markSent")}
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      {error ? <p className="mt-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
    </section>
  );
}
