"use client";

import { useState, type ReactNode } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { compareLinks, convertAmount, parsePastedPrice, type CompareQuery, type PastedPrice } from "@/lib/secretary/compare";

/**
 * «قارن» — ONE panel for /secretary and /basic (the owner, 2026-10-26): the
 * stay as we hold it, Booking / أجودا / المسافر opened in a popup BESIDE our
 * system (their sites forbid framing), a paste box that reads the price the
 * employee saw with their own eyes, and the difference against ours. What the
 * paste then does is the caller's (`action`): a new proposal hotel in
 * /secretary, «استخدم هذا السعر» on the row in /basic. Nothing is written by
 * itself, nothing reaches a client.
 */

export function openCompare(url: string) {
  const mobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  if (mobile) { window.open(url, "_blank", "noopener"); return; }
  const w = Math.min(960, Math.round(window.screen.availWidth / 2));
  const h = Math.round(window.screen.availHeight * 0.92);
  window.open(url, "tv-compare", `width=${w},height=${h},left=0,top=0,noopener`);
}

export function ComparePanel({ query, current, sarPer, action }: {
  query: CompareQuery;
  /** our stay's price (whole stay) — shown and compared; null hides it (no pricing.internal) */
  current: { amount: number; currency: string } | null;
  /** to compare across currencies; without it only the same currency is compared */
  sarPer?: Record<string, number>;
  /** what the employee may do with the price they pasted */
  action: (parsed: PastedPrice | null) => ReactNode;
}) {
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);
  const parsed = parsePastedPrice(pasted);
  const links = compareLinks(query);

  async function copyCurrent() {
    if (!current) return;
    try { await navigator.clipboard.writeText(`${current.amount} ${current.currency}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select by hand */ }
  }

  const diff = parsed && current ? convertAmount(parsed.amount, parsed.currency, current.currency, sarPer ?? {}) : null;

  return <div className="space-y-2">
    <div className="flex flex-wrap items-baseline gap-2 text-sm">
      <strong>{query.cityAr}</strong>
      {query.hotelName && <span className="text-[#557d78]">{query.hotelName}</span>}
      <span className="text-xs text-tv-text-faint tabular-nums">{query.checkIn ?? "؟"} ← {query.checkOut ?? "؟"} · {query.rooms} غرفة · {query.adults} بالغ</span>
      {current && <button type="button" onClick={() => void copyCurrent()} className="inline-flex items-center gap-1 rounded border border-[#dbe6e1] px-2 py-0.5 text-xs font-bold text-[#185045] max-sm:min-h-10">
        <Copy size={11} /> {copied ? "نُسخ ✓" : `سعرنا للإقامة: ${current.amount.toLocaleString("en-US")} ${current.currency}`}
      </button>}
    </div>
    <div className="flex flex-wrap gap-2">
      {links.map((l) => <button key={l.key} type="button" onClick={() => openCompare(l.url)}
        className="tv-btn-secondary inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold max-sm:min-h-10">
        <ExternalLink size={12} /> {l.label}
      </button>)}
    </div>
    <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="الصق السعر الذي رأيته لكامل الإقامة (مثل: SAR 1,250)"
      aria-label="الصق السعر" className="w-full rounded-lg border border-[#dbe6e1] p-2 text-sm" dir="auto" />
    {parsed && <p className="text-xs text-[#557d78]">
      قرأت: <b className="tabular-nums">{parsed.amount.toLocaleString("en-US")} {parsed.currency}</b>{parsed.assumed ? " (افترضتها ريالاً — صحّح إن كانت غيرها)" : ""}
      {current && diff != null && <> — {diff < current.amount
        ? `أرخص بـ ${Math.round(current.amount - diff).toLocaleString("en-US")} ${current.currency}`
        : `أغلى بـ ${Math.round(diff - current.amount).toLocaleString("en-US")} ${current.currency}`}</>}
    </p>}
    {action(parsed)}
  </div>;
}
