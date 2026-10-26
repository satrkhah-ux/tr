"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Scale } from "lucide-react";
import type { PastedPrice } from "@/lib/secretary/compare";
import { ComparePanel } from "./ComparePanel";
import { applyComparedHotel, listMyProposals, type Proposal, type ProposalStay } from "@/lib/secretary/proposals";

/**
 * «قارن» (the owner, 2026-10-26): beside every proposal's stay, buttons that
 * open Booking / أجودا / المسافر in a popup NEXT TO our system (never inside
 * it — their sites forbid framing), a paste box that reads the price the
 * employee saw with their own eyes, and «+ أضف هذا الفندق بديلاً» that writes
 * it into THEIR proposal draft by their hand. Nothing reaches any client.
 */

function StayCompare({ proposal, stay }: { proposal: Proposal; stay: ProposalStay }) {
  const [hotelName, setHotelName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function apply(parsed: PastedPrice) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const r = await applyComparedHotel({ draftId: proposal.id, cityKey: stay.cityKey, hotelName, amount: parsed.amount, currency: parsed.currency, site: "لصق يدوي" });
      if (r.ok) setDone(r.staySar);
      else setError(r.error);
    } catch { setError("تعذّر الاتصال."); } finally { setBusy(false); }
  }

  return <div className="rounded-xl border border-[#e3e9e6] bg-white p-3">
    <ComparePanel
      query={{ hotelName: stay.hotelName, cityEn: stay.cityEn, cityAr: stay.cityAr, checkIn: stay.checkIn, checkOut: stay.checkOut, adults: proposal.adults, rooms: stay.roomsCount }}
      current={stay.currentTotal}
      action={(parsed) => done == null
        ? <div className="flex flex-wrap gap-2">
            <input value={hotelName} onChange={(e) => setHotelName(e.target.value)} maxLength={150} placeholder="اسم الفندق الذي وجدته…"
              className="min-w-0 flex-1 rounded-lg border border-[#dbe6e1] p-2 text-sm" />
            <button type="button" disabled={busy || !parsed || !hotelName.trim()} onClick={() => parsed && void apply(parsed)}
              className="rounded-lg bg-[var(--tv-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : "+ أضف هذا الفندق بديلاً"}
            </button>
          </div>
        : <p className="rounded-lg bg-emerald-50 p-2 text-xs font-bold text-emerald-800">
            ✓ أُضيف «{hotelName}» بسعر ≈{done.toLocaleString("en-US")} ريال — <Link href={`/basic/${proposal.id}`} className="underline">افتح المسودة وراجع ثم أصدر</Link>. السعر بيدك أنت وتأكيده عليك.
          </p>}
    />
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
