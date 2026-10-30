"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Send } from "lucide-react";
import { listPreparedMessages, sendClientMessageNow, type PreparedList } from "@/lib/data/operation-client-send";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useBasicLabels } from "./labels";

/**
 * «أرسل له رابط متابعة الحجوزات» — once the client confirmed (the owner,
 * 2026-10-22: «عند التأكيد نرسل الرابط لمتابعة الحجوزات»), in the issued
 * section itself: the case's prepared «رابط الرحلة» (client-booking-state.ts —
 * the trip page and our booking numbers), read and edited, then sent by the
 * employee. Nothing goes by itself. Gone once sent — the case keeps it as
 * dispatched, so it is not offered twice.
 */
export function TripLinkSend({ operationId }: { operationId: string }) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const [list, setList] = useState<PreparedList | null>(null);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    listPreparedMessages(operationId)
      .then((r) => live && setList(r.ok ? r.list : null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [operationId, tick]);

  const item = list?.items.find((m) => m.key === "trip_link");
  // what happened stays said — a send held outside the 24 hours included, after the list reloads
  if (said && !item) return <p role="status" className={`text-[12px] font-bold ${said.ok ? "text-[#0f7a52]" : "text-[#a86a10]"}`}>{said.text}</p>;
  if (!item) {
    // no button: say why, so step ③ never asks for a link it cannot offer
    if (!list) return null;
    const went = list.delivered.includes("trip_link");
    const why = went ? tx("tripLinkSent") : !list.to_phone ? t("ops.err.clientNoPhone") : tx("tripLinkPending");
    return <p className={`text-[12px] font-bold ${went ? "text-[#0f7a52]" : "text-tv-text-faint"}`}>{why}</p>;
  }

  async function send() {
    if (!item) return;
    setBusy(true);
    setSaid(null);
    try {
      const r = await sendClientMessageNow({ operation_id: operationId, body, key: item.key });
      if (!r.ok) return setSaid({ text: t(r.error), ok: false });
      setSaid({ text: r.result === "sent" ? tx("tripLinkSent") : t("ops.toClient.window"), ok: r.result === "sent" });
      setOpen(false);
      setTick((n) => n + 1);
    } catch {
      setSaid({ text: tx("fileErr_failed"), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {open ? (
        <div className="space-y-2 rounded-[12px] border border-[#cfe0d9] bg-[#f7fbf9] p-3">
          {list?.blocked ? <p className="text-[11.5px] font-bold text-[#a86a10]">{t(list.blocked)}</p> : null}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.min(Math.max(body.split("\n").length + 1, 6), 14)}
            aria-label={tx("tripLinkSend")}
            className="w-full rounded-[10px] border border-[#dbe6e1] bg-white p-2.5 text-[13px] leading-6 text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !body.trim() || Boolean(list?.blocked)}
              className="tv-btn-primary inline-flex h-9 items-center gap-1.5 rounded-[9px] px-4 text-[12.5px] font-extrabold disabled:opacity-50 max-sm:min-h-10"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
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
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#cfe0d9] bg-white px-3 text-[12px] font-bold text-[#185045]"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? tx("sendCopied") : tx("sendCopy")}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-9 px-2 text-[12px] font-bold text-[#557d78] max-sm:min-h-10">
              {tx("cancelEdit")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setBody(item.body);
            setOpen(true);
            setSaid(null);
          }}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-[#1f8a5b] px-4 text-[13px] font-extrabold text-white hover:bg-[#18744c] sm:w-auto"
        >
          <Link2 className="size-4" />
          {tx("tripLinkSend")}
        </button>
      )}
      {said && !said.ok ? <p role="alert" className="text-[12px] font-bold text-[#a86a10]">{said.text}</p> : null}
    </div>
  );
}
