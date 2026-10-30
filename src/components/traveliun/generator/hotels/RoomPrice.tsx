"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, Save } from "lucide-react";
import { DirText } from "@/components/DirText";
import { recallHotelRate, rememberHotelRate, type RememberedRate } from "@/lib/data/hotel-rates";
import type { DraftRoomSpec } from "@/lib/offer/draft-types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass } from "../stage-props";

/**
 * What one room costs for the WHOLE stay — the figure the agent reads off the
 * supplier — and, worked out beside it, what that is a night.
 *
 * The memory is per NIGHT (0054): saved as total ÷ nights, offered back as
 * per-night × this stay's nights, so a 3-night price never fills a 5-night
 * stay as if it were the whole of it. Saving is an explicit press; recall is
 * automatic, and only into an empty box or after the room itself changed.
 */
export function RoomPrice({
  room,
  nights,
  currency,
  hotelId,
  onChange,
}: {
  room: DraftRoomSpec;
  nights: number;
  currency: string;
  hotelId: string | null;
  onChange: (slice: Partial<DraftRoomSpec>) => void;
}) {
  const { t } = useTraveliunUI();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [remembered, setRemembered] = useState<RememberedRate | null>(null);
  const n = Math.max(nights, 1);
  const perNight = room.price != null ? Math.round((room.price / n) * 100) / 100 : null;

  const productKey = `${hotelId ?? ""}|${room.room_type_name}|${room.board_type ?? ""}`;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    const first = lastKey.current === null;
    if (lastKey.current === productKey) return;
    lastKey.current = productKey;
    setRemembered(null);
    if (!hotelId || !room.room_type_name.trim()) return;
    let live = true;
    void recallHotelRate(hotelId, room.room_type_name, room.board_type).then((hit) => {
      if (!live || !hit) return;
      setRemembered(hit);
      // An empty box takes it; so does a room just switched to — the figure
      // showing then belonged to the room the agent left. A saved draft's own
      // figure is never touched on first paint.
      if (room.price == null || !first) onChange({ price: Math.round(hit.price * n * 100) / 100 });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productKey]);

  function save() {
    if (!hotelId || !room.room_type_name.trim() || perNight == null || perNight <= 0) return;
    startTransition(async () => {
      const result = await rememberHotelRate({
        hotelId,
        roomTypeName: room.room_type_name,
        boardType: room.board_type,
        price: perNight,
        currency,
      });
      if (!result.ok) return;
      setRemembered({ price: perNight, currency, updated_at: new Date().toISOString() });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    });
  }

  const differs = remembered !== null && perNight !== null && remembered.price !== perNight;

  return (
    <div className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
      <span>{t("pg.roomTotal", { nights: n, currency })}</span>
      <div className="flex gap-1.5">
        <input
          type="number"
          min={0}
          dir="ltr"
          value={room.price ?? ""}
          onChange={(e) => onChange({ price: e.target.value === "" ? null : Number(e.target.value) })}
          className={`${fieldClass} tv-tnum min-w-0 flex-1 text-center`}
          placeholder="0"
        />
        {hotelId && room.room_type_name.trim() ? (
          <button
            type="button"
            onClick={save}
            disabled={pending || perNight == null || perNight <= 0}
            title={t("pg.rememberRateHint")}
            aria-label={t("pg.rememberRateHint")}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] transition-colors disabled:opacity-40 ${
              saved ? "bg-[#0f7a52] text-white" : "border border-[#b7d0c7] bg-white text-[#185045] hover:bg-[#f0f7f4]"
            }`}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : <Save className="size-4" />}
          </button>
        ) : null}
      </div>
      {perNight != null ? (
        <span className="text-[11px] font-semibold text-[#557d78]">
          {t("pg.perNight")} <DirText dir="ltr" className="tv-tnum font-extrabold">{`${perNight} ${currency}`}</DirText>
        </span>
      ) : null}
      {/* only when it DISAGREES with the box — repeating the same number is noise */}
      {differs && remembered ? (
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-tv-text-faint">
          {t("pg.lastSavedNight")}
          <DirText dir="ltr" className="tv-tnum font-bold text-[#557d78]">{`${remembered.price} ${remembered.currency}`}</DirText>
          <button
            type="button"
            onClick={() => onChange({ price: Math.round(remembered.price * n * 100) / 100 })}
            className="tv-btn-secondary rounded-full border px-2 py-0.5 text-[10.5px] font-bold max-sm:min-h-10"
          >
            {t("pg.useLastRate")}
          </button>
        </span>
      ) : null}
    </div>
  );
}
