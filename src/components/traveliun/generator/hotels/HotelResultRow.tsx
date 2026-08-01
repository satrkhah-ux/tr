"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Star } from "lucide-react";
import { DirText } from "@/components/DirText";
import { BOARD_LABEL_KEYS } from "@/lib/offer/draft-types";
import type { HotelOption, HotelRateOption } from "@/lib/data/hotel-search";
import { useTraveliunUI } from "../../TraveliunUIProvider";

/**
 * One hotel in the results — the same row whichever source produced it.
 *
 * Collapsed by default to its CHEAPEST rate. A supplier answers a four-night
 * search with five room types per hotel, and eight hotels then became forty
 * lines to read before any decision could be made. The hotel is the choice; the
 * room is a detail of it, so the room list opens only when the agent wants it.
 */
export function HotelResultRow({
  hotel,
  busyKey,
  onSelect,
}: {
  hotel: HotelOption;
  /** rate key currently being saved, so only that button spins. */
  busyKey: string | null;
  onSelect: (hotel: HotelOption, rate: HotelRateOption | null) => void;
}) {
  const { t } = useTraveliunUI();
  const [open, setOpen] = useState(false);
  const rates = hotel.rates;
  const best = rates[0] ?? null;

  return (
    <div className="rounded-[10px] border border-[#e2ebe7] bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-2.5">
        {hotel.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hotel.image} alt="" className="h-12 w-16 shrink-0 rounded-[7px] object-cover" />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[12.5px] font-extrabold text-[#003c3a]">{hotel.name}</span>
            {hotel.stars ? (
              <span className="inline-flex items-center text-[#e0a400]">
                {Array.from({ length: hotel.stars }).map((_, i) => (
                  <Star key={i} className="size-3 fill-current" />
                ))}
              </span>
            ) : null}
          </div>
          {best ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-[#557d78]">
              <span>{best.room}</span>
              {best.board ? <span className="text-[#93aaa3]">· {t(BOARD_LABEL_KEYS[best.board])}</span> : null}
              {/* Refundability is a promise we repeat to the client, so it is
                  shown as words when we have them and omitted when we do not —
                  never guessed. */}
              {best.refundable === true ? (
                <span className="text-[#10966b]">· {t("pg.supplier.refundable")}</span>
              ) : best.refundable === false ? (
                <span className="text-[#c22850]">· {t("pg.supplier.nonRefundable")}</span>
              ) : null}
              {best.note ? <span className="text-[#93aaa3]">· {best.note}</span> : null}
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] font-bold text-[#a86a10]">لا يوجد سعر سابق — يُدخَل يدوياً</p>
          )}
        </div>

        {best ? (
          <div className="text-end">
            <p className="tv-tnum text-[13px] font-extrabold text-[#0f3d38]">
              <DirText dir="ltr">{`${best.per_night} ${best.currency}`}</DirText>
              <span className="text-[11px] font-bold text-[#93aaa3]"> / ليلة</span>
            </p>
            <p className="tv-tnum text-[11px] font-bold text-[#557d78]">
              <DirText dir="ltr">{`${Math.round(best.total)} ${best.currency}`}</DirText> إجمالي
            </p>
          </div>
        ) : null}

        <button
          type="button"
          disabled={busyKey !== null}
          onClick={() => onSelect(hotel, best)}
          className="inline-flex h-8 items-center gap-1 rounded-[8px] bg-[#185045] px-3 text-[11.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
        >
          {busyKey === (best?.key ?? hotel.id) ? <Loader2 className="size-3 animate-spin" /> : null}
          {t("pg.supplier.select")}
        </button>

        {rates.length > 1 ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="بقية الغرف"
            className={`inline-flex size-8 items-center justify-center rounded-[8px] border border-[#dbe6e1] text-[#557d78] transition-transform hover:bg-[#f4f8f6] ${open ? "rotate-180" : ""}`}
          >
            <ChevronDown className="size-3.5" />
          </button>
        ) : null}
      </div>

      {/* the other rooms — same hotel, different product */}
      {open ? (
        <div className="border-t border-[#eef4f1] p-2 ps-4">
          {rates.slice(1).map((rate) => (
            <div key={rate.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-[11.5px]">
              <span className="font-bold text-[#185045]">{rate.room}</span>
              {rate.board ? (
                <span className="rounded-full bg-[#eef4f1] px-2 py-0.5 font-bold text-[#557d78]">
                  {t(BOARD_LABEL_KEYS[rate.board])}
                </span>
              ) : null}
              {rate.refundable === false ? (
                <span className="rounded-full bg-[#fdeef2] px-2 py-0.5 font-bold text-[#c22850]">
                  {t("pg.supplier.nonRefundable")}
                </span>
              ) : null}
              <span className="tv-tnum font-extrabold text-[#0f3d38]">
                <DirText dir="ltr">{`${rate.per_night} ${rate.currency}`}</DirText>
                <span className="font-bold text-[#93aaa3]"> / ليلة</span>
              </span>
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => onSelect(hotel, rate)}
                className="ms-auto inline-flex h-7 items-center gap-1 rounded-[8px] border border-[#b7d0c7] px-2.5 text-[11px] font-bold text-[#185045] hover:bg-[#f0f7f4] disabled:opacity-60"
              >
                {busyKey === rate.key ? <Loader2 className="size-3 animate-spin" /> : null}
                {t("pg.supplier.select")}
              </button>
              {rate.policy ? (
                <p className="basis-full text-[11px] font-semibold text-[#93aaa3]">{rate.policy}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* the terms of the rate on the row itself — the client will be told these */}
      {best?.policy ? (
        <p className="border-t border-[#eef4f1] px-2.5 py-1.5 text-[11px] font-semibold text-[#93aaa3]">
          {best.policy}
        </p>
      ) : null}
    </div>
  );
}
