"use client";

import { useState } from "react";
import { Scale, X } from "lucide-react";
import type { DraftHotel } from "@/lib/offer/draft-types";
import { pastedToRoomPrice, type PastedPrice } from "@/lib/secretary/compare";
import { ComparePanel } from "../secretary/ComparePanel";

/**
 * «قارن» on a Basic hotel row (the owner, 2026-10-26: «قارن لم تظهر هنا؟»):
 * the same panel as /secretary over THIS stay — its hotel, dates, rooms and
 * party — and «استخدم هذا السعر»: the pasted whole-stay price, split per room
 * and per night in the stay's own currency, written into the row ONLY after a
 * second, confirming click. A different hotel's name typed here replaces the
 * row's hotel as a typed one (it joins /hotels through the existing path).
 * Shown to pricing.internal staff only (the caller gates it).
 */
export function HotelCompare({ line, cityName, hotelNameEn, checkIn, checkOut, nights, adults, sarPer, onApply }: {
  line: DraftHotel;
  cityName: string;
  hotelNameEn: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number;
  adults: number;
  sarPer: Record<string, number>;
  onApply: (next: DraftHotel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [otherHotel, setOtherHotel] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const rooms = Math.max(line.rooms.length, 1);
  const currency = line.manual_currency?.trim() || "SAR";
  const typed = line.rooms.reduce((n: number | null, r) => (n == null || r.price == null ? null : n + r.price), 0 as number | null);

  if (!open) {
    return <button type="button" onClick={() => { setOpen(true); setDone(false); }}
      className="tv-btn-secondary inline-flex h-7 items-center gap-1 rounded-[7px] border px-2.5 text-[11.5px] font-bold max-sm:min-h-10">
      <Scale className="size-3.5" /> قارن
    </button>;
  }

  function use(parsed: PastedPrice) {
    const price = pastedToRoomPrice(parsed, { currency, nights, rooms }, sarPer);
    if (!price) return;
    const name = otherHotel.trim();
    onApply({
      ...line,
      ...(name && name !== line.hotel_name ? { hotel_id: null, hotel_name: name, hotel_name_en: "" } : {}),
      sourcing: null,
      priced_nights: nights,
      rooms: line.rooms.map((r) => ({ ...r, price: price.perRoomStay })),
    });
    setConfirming(false);
    setDone(true);
  }

  return <div className="w-full rounded-xl border border-[#cfe0db] bg-[#fbfdfc] p-3">
    <div className="mb-2 flex items-center gap-2">
      <Scale className="size-4 text-[#557d78]" />
      <strong className="flex-1 text-sm">قارن سعر هذه الإقامة</strong>
      <button type="button" onClick={() => { setOpen(false); setConfirming(false); }} aria-label="أغلق" className="rounded p-1 text-[#557d78] hover:bg-[#eef3f1]"><X className="size-4" /></button>
    </div>
    <ComparePanel
      query={{ hotelName: hotelNameEn || line.hotel_name || null, cityEn: null, cityAr: cityName, checkIn, checkOut, adults, rooms }}
      current={typed != null ? { amount: typed, currency } : null}
      sarPer={sarPer}
      action={(parsed) => {
        const price = parsed ? pastedToRoomPrice(parsed, { currency, nights, rooms }, sarPer) : null;
        if (done) return <p className="rounded-lg bg-emerald-50 p-2 text-xs font-bold text-emerald-800">✓ كُتب السعر في الصف بيدك — راجعه قبل الإصدار.</p>;
        if (parsed && !price) return <p className="text-xs text-red-700">لا أعرف تحويل {parsed.currency} إلى {currency} — اكتب السعر بعملة الإقامة.</p>;
        return <div className="space-y-2">
          <input value={otherHotel} onChange={(e) => setOtherHotel(e.target.value)} maxLength={150}
            placeholder="فندق آخر وجدته؟ اكتب اسمه (اتركه فارغاً لنفس الفندق)" className="w-full rounded-lg border border-[#dbe6e1] p-2 text-sm" />
          {!confirming
            ? <button type="button" disabled={!price} onClick={() => setConfirming(true)}
                className="rounded-lg bg-[var(--tv-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">استخدم هذا السعر</button>
            : price && <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-[#5a4300]">
                <span className="flex-1">سيُكتب <b className="tabular-nums">{price.perRoomNight.toLocaleString("en-US")} {currency}</b> لليلة لكل غرفة ({rooms} غرفة × {nights} ليالٍ){otherHotel.trim() ? ` وفندق «${otherHotel.trim()}»` : ""}. متأكد؟</span>
                <button type="button" onClick={() => parsed && use(parsed)} className="rounded bg-[var(--tv-brand)] px-3 py-1 font-bold text-white max-sm:min-h-10">أكّد</button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded border border-[#dbe6e1] bg-white px-3 py-1 font-bold max-sm:min-h-10">إلغاء</button>
              </div>}
        </div>;
      }}
    />
  </div>;
}
