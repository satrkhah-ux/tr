"use client";

import { Pencil, RefreshCw, Repeat2, Star } from "lucide-react";
import { DirText } from "@/components/DirText";
import { BOARD_LABEL_KEYS, type DraftHotel } from "@/lib/offer/draft-types";
import { useTraveliunUI } from "../../TraveliunUIProvider";

/**
 * What has been decided for this stay — and nothing else.
 *
 * This card is the answer to the question the old screen could not answer:
 * «ما السعر المعتمد ومن أين جاء؟» A dropdown showing a hotel, a search panel
 * saying "no matches", and a manual price of 0 were all on screen at once, and
 * none of them was labelled as the one that counts.
 *
 * So: the hotel, the room, the price BOTH ways (per night and total), the terms,
 * and a badge naming the source. Editing is behind a button, because a form is
 * for changing something and this is for reading it.
 */
export function StaySummary({
  line,
  nights,
  sourceLabel,
  canInternal,
  onEdit,
  onChange,
  onRefresh,
}: {
  line: DraftHotel;
  nights: number;
  sourceLabel: string;
  canInternal: boolean;
  onEdit: () => void;
  onChange: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTraveliunUI();
  const s = line.sourcing;

  const total = s ? s.sell_base : line.manual_price;
  const currency = s ? "SAR" : line.manual_currency;
  const perNight = total != null && nights > 0 ? Math.round((total / nights) * 100) / 100 : null;
  const room = s?.room_name || line.room_type_name;
  const stars = s?.star_rating ?? null;
  const blocked = s?.blocked ?? false;

  return (
    <div
      className={`rounded-[11px] border p-3 ${
        blocked ? "border-[#f0c7c7] bg-[#fdeef2]" : "border-[#d6eadf] bg-[#f2fbf6]"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        {s?.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.image_url} alt="" className="h-16 w-24 shrink-0 rounded-[8px] object-cover" />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-extrabold text-[#003c3a]">{line.hotel_name || "—"}</span>
            {stars ? (
              <span className="inline-flex items-center text-[#e0a400]">
                {Array.from({ length: stars }).map((_, i) => (
                  <Star key={i} className="size-3 fill-current" />
                ))}
              </span>
            ) : null}
            {/* Where the price came from — the badge is the point of the card. */}
            <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-extrabold text-[#557d78] ring-1 ring-[#d6eadf]">
              {sourceLabel}
            </span>
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] font-bold text-[#557d78]">
            {room ? <span>{room}</span> : null}
            {line.board_type ? <span>· {t(BOARD_LABEL_KEYS[line.board_type])}</span> : null}
            <span>
              · <DirText dir="ltr">{line.rooms_count}</DirText> غرفة
            </span>
            <span>
              · <DirText dir="ltr">{nights}</DirText> ليلة
            </span>
          </p>

          {total != null ? (
            <p className="tv-tnum mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              {perNight != null ? (
                <span className="text-[14px] font-extrabold text-[#0f3d38]">
                  <DirText dir="ltr">{`${perNight} ${currency}`}</DirText>
                  <span className="text-[11px] font-bold text-[#93aaa3]"> / ليلة</span>
                </span>
              ) : null}
              <span className="text-[12px] font-bold text-[#557d78]">
                <DirText dir="ltr">{`${Math.round(total)} ${currency}`}</DirText> إجمالي
              </span>
              {canInternal && s ? (
                <span className="text-[11px] font-bold text-[#93aaa3]">
                  {t("pg.supplier.net")}: <DirText dir="ltr">{`${s.net_base} SAR`}</DirText>
                  {s.margin_pct != null ? ` · ${t("pg.marginCol")} ${s.margin_pct}%` : ""}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="mt-1.5 text-[11.5px] font-bold text-[#a86a10]">بلا سعر بعد — افتح «تعديل» وأدخِله.</p>
          )}

          {s?.cancellation_policy ? (
            <p className="mt-1 text-[11px] font-semibold text-[#557d78]">{s.cancellation_policy}</p>
          ) : null}
          {s && s.excluded_surcharges.length > 0 ? (
            <p className="mt-1 text-[11px] font-semibold text-[#557d78]">
              <span className="font-bold">{t("pg.supplier.payAtHotel")}: </span>
              {s.excluded_surcharges.map((x, i) => (
                <span key={i} className="tv-tnum">
                  {i > 0 ? "، " : ""}
                  {x.name} (<DirText dir="ltr">{`${x.amount} ${x.currency}`}</DirText>)
                </span>
              ))}
            </p>
          ) : null}
          {blocked ? (
            <p className="mt-1 text-[11.5px] font-extrabold text-[#c22850]">{t("pg.supplier.blocked")}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {s ? (
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] px-2.5 text-[11.5px] font-bold text-[#557d78] hover:bg-white"
            >
              <RefreshCw className="size-3.5" />
              تحديث السعر
            </button>
          ) : null}
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-white"
          >
            <Pencil className="size-3.5" />
            تعديل
          </button>
          <button
            type="button"
            onClick={onChange}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#185045] px-2.5 text-[11.5px] font-bold text-white hover:bg-[#0f4439]"
          >
            <Repeat2 className="size-3.5" />
            تغيير الفندق
          </button>
        </div>
      </div>
    </div>
  );
}
