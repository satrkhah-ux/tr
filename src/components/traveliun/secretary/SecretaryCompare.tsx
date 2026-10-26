"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, Loader2, Scale } from "lucide-react";
import { compareLinks, parsePastedPrice } from "@/lib/secretary/compare";
import { applyComparedHotel, listMyProposals, type Proposal, type ProposalStay } from "@/lib/secretary/proposals";

/**
 * «قارن» (the owner, 2026-10-26): beside every proposal's stay, buttons that
 * open Booking / أجودا / المسافر in a popup NEXT TO our system (never inside
 * it — their sites forbid framing), a paste box that reads the price the
 * employee saw with their own eyes, and «+ أضف هذا الفندق بديلاً» that writes
 * it into THEIR proposal draft by their hand. Nothing reaches any client.
 */

function openCompare(url: string) {
  const mobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  if (mobile) { window.open(url, "_blank", "noopener"); return; }
  const w = Math.min(960, Math.round(window.screen.availWidth / 2));
  const h = Math.round(window.screen.availHeight * 0.92);
  window.open(url, "tv-compare", `width=${w},height=${h},left=0,top=0,noopener`);
}

function StayCompare({ proposal, stay }: { proposal: Proposal; stay: ProposalStay }) {
  const [hotelName, setHotelName] = useState("");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const parsed = parsePastedPrice(pasted);
  const links = compareLinks({ hotelName: stay.hotelName, cityEn: stay.cityEn, cityAr: stay.cityAr, checkIn: stay.checkIn, checkOut: stay.checkOut, adults: proposal.adults, rooms: stay.roomsCount });

  async function copyCurrent() {
    if (!stay.currentTotal) return;
    try { await navigator.clipboard.writeText(`${stay.currentTotal.amount} ${stay.currentTotal.currency}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select by hand */ }
  }

  async function apply() {
    if (!parsed || busy) return;
    setBusy(true); setError("");
    try {
      const r = await applyComparedHotel({ draftId: proposal.id, cityKey: stay.cityKey, hotelName, amount: parsed.amount, currency: parsed.currency, site: "لصق يدوي" });
      if (r.ok) setDone(r.staySar);
      else setError(r.error);
    } catch { setError("تعذّر الاتصال."); } finally { setBusy(false); }
  }

  return <div className="rounded-xl border border-[#e3e9e6] bg-white p-3">
    <div className="flex flex-wrap items-baseline gap-2 text-sm">
      <strong>{stay.cityAr}</strong>
      <span className="text-[#557d78]">{stay.hotelName}</span>
      <span className="text-xs text-[#8ba09b] tabular-nums">{stay.checkIn ?? "؟"} ← {stay.checkOut ?? "؟"} · {stay.nights} ليالٍ · {stay.roomsCount} غرفة</span>
      {stay.currentTotal && <button type="button" onClick={() => void copyCurrent()} className="inline-flex items-center gap-1 rounded border border-[#dbe6e1] px-2 py-0.5 text-xs font-bold text-[#185045]">
        <Copy size={11} /> {copied ? "نُسخ ✓" : `سعرنا: ${stay.currentTotal.amount} ${stay.currentTotal.currency}`}
      </button>}
    </div>
    <div className="mt-2 flex flex-wrap gap-2">
      {links.map((l) => <button key={l.key} type="button" onClick={() => openCompare(l.url)}
        className="inline-flex items-center gap-1 rounded-lg border border-[#dbe6e1] px-3 py-1.5 text-xs font-bold text-[#185045] hover:bg-[#f4f8f6]">
        <ExternalLink size={12} /> {l.label}
      </button>)}
    </div>
    {done == null ? <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
      <input value={hotelName} onChange={(e) => setHotelName(e.target.value)} maxLength={150} placeholder="اسم الفندق الذي وجدته…"
        className="rounded-lg border border-[#dbe6e1] p-2 text-sm" />
      <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="الصق السعر هنا (مثل: SAR 1,250)"
        className="rounded-lg border border-[#dbe6e1] p-2 text-sm" dir="auto" />
      <button type="button" disabled={busy || !parsed || !hotelName.trim()} onClick={() => void apply()}
        className="rounded-lg bg-[var(--tv-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
        {busy ? <Loader2 size={13} className="animate-spin" /> : "+ أضف هذا الفندق بديلاً"}
      </button>
      {parsed && <p className="text-xs text-[#557d78] md:col-span-3">
        قرأت: <b className="tabular-nums">{parsed.amount.toLocaleString("en-US")} {parsed.currency}</b>{parsed.assumed ? " (افترضتها ريالاً — صحّح إن كانت غيرها)" : ""}
        {stay.currentTotal && parsed.currency === stay.currentTotal.currency && <> — {parsed.amount < stay.currentTotal.amount ? `أرخص بـ ${(stay.currentTotal.amount - parsed.amount).toLocaleString("en-US")}` : `أغلى بـ ${(parsed.amount - stay.currentTotal.amount).toLocaleString("en-US")}`} {parsed.currency}</>}
      </p>}
    </div> : <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs font-bold text-emerald-800">
      ✓ أُضيف «{hotelName}» بسعر ≈{done.toLocaleString("en-US")} ريال — <Link href={`/basic/${proposal.id}`} className="underline">افتح المسودة وراجع ثم أصدر</Link>. السعر بيدك أنت وتأكيده عليك.
    </p>}
    {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
  </div>;
}

export function SecretaryCompare() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    listMyProposals().then((p) => { if (active && p) setProposals(p); }).catch(() => null);
    return () => { active = false; };
  }, []);
  if (!proposals.length) return null;
  const when = (iso: string) => new Date(iso).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" });

  return <section className="rounded-2xl border border-[#dfe8e4] bg-white p-4">
    <div className="mb-1 flex items-center gap-2">
      <Scale className="size-4 text-[#557d78]" />
      <h2 className="font-bold">عروض مقترحة من سكرتيرك — قارن بنفسك</h2>
    </div>
    <p className="mb-3 text-sm text-[#5b7a71]">افتح أجودا أو المسافر أو Booking بجانب النظام، انسخ السعر الذي تراه والصقه هنا — وما تضيفه يُكتب بيدك ويبقى عليك تأكيده.</p>
    <div className="space-y-2">
      {proposals.map((p) => <div key={p.id} className="rounded-xl border border-[#e7eceb]">
        <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} className="flex w-full flex-wrap items-center gap-2 p-3 text-start text-sm">
          <strong>{p.title ?? "مقترح"}</strong>
          <span className="text-xs text-[#8ba09b]">{when(p.createdAt)}</span>
          <span className="flex-1" />
          <Link href={`/basic/${p.id}`} className="text-xs font-bold text-[var(--tv-brand)] underline" onClick={(e) => e.stopPropagation()}>افتح في بيسك</Link>
        </button>
        {open === p.id && <div className="space-y-2 border-t border-[#eef3f1] p-3">
          {p.stays.map((s) => <StayCompare key={s.cityKey} proposal={p} stay={s} />)}
        </div>}
      </div>)}
    </div>
  </section>;
}
