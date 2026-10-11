"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, Save } from "lucide-react";
import { DirText } from "@/components/DirText";
import { recallHotelRate, rememberHotelRate, type RememberedRate } from "@/lib/data/hotel-rates";
import { currencyOptions, type DraftHotel, type LookupCountry } from "@/lib/offer/draft-types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass } from "../stage-props";

const rowLabelClass = "grid gap-1.5 text-[11.5px] font-bold text-[#557d78]";

/**
 * The price of a stay, and the memory of what this room last cost.
 *
 * The agent prices «آيوتا تبليسي · استاندر · إفطار» once; every later file that
 * books the same room opens with that number already in the box. Saving is an
 * explicit press — a figure typed and then reconsidered should not quietly
 * become the house answer — while recall is automatic, because the whole point
 * is not having to ask for it.
 *
 * Only for a price that is OURS. A supplier rate is a quote we were given, and
 * this component is never rendered for one.
 */
export function ManualPriceRow({
  line,
  countries,
  onSetHotel,
  onSaved,
}: {
  line: DraftHotel;
  /** whose currencies the dropdown offers — every country's own, not a fixed ten. */
  countries: Pick<LookupCountry, "default_currency">[];
  onSetHotel: (slice: Partial<DraftHotel>) => void;
  /** Called after a successful save, so the card can hand over to the next. */
  onSaved?: () => void;
}) {
  const { t } = useTraveliunUI();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [remembered, setRemembered] = useState<RememberedRate | null>(null);

  const room = line.rooms[0]?.room_type_name?.trim() ?? "";
  const board = line.rooms[0]?.board_type ?? null;
  // The product this price belongs to. When it changes, the old price is for
  // something else.
  const productKey = `${line.hotel_id ?? ""}|${room}|${board ?? ""}`;
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    const first = lastKey.current === null;
    if (lastKey.current === productKey) return;
    lastKey.current = productKey;
    setRemembered(null);
    if (!line.hotel_id || !room) return;

    let active = true;
    void recallHotelRate(line.hotel_id, room, board).then((hit) => {
      if (!active || !hit) return;
      setRemembered(hit);
      // Fill the box when it is empty, and when the agent has just switched to
      // a DIFFERENT room — the figure showing then belongs to the room they
      // left. On the very first render of a saved draft nothing is touched:
      // whatever that file says is what it says.
      if (line.manual_price == null || !first) {
        onSetHotel({ manual_price: hit.price, manual_currency: hit.currency });
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productKey]);

  function save() {
    if (!line.hotel_id || !room || !line.manual_price) return;
    startTransition(async () => {
      const result = await rememberHotelRate({
        hotelId: line.hotel_id!,
        roomTypeName: room,
        boardType: board,
        price: line.manual_price!,
        currency: line.manual_currency || "SAR",
      });
      if (!result.ok) return;
      setRemembered({
        price: line.manual_price!,
        currency: line.manual_currency || "SAR",
        updated_at: new Date().toISOString(),
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    });
  }

  // A hotel typed by hand has no identity to remember against: the same name
  // in two cities is two different hotels, and one would overwrite the other.
  const canRemember = Boolean(line.hotel_id && room);
  const differs = remembered !== null && line.manual_price !== null && remembered.price !== line.manual_price;

  return (
    <div className="mt-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
        <label className={rowLabelClass}>
          {t("pg.manualPrice")} — للإقامة كاملة
          <input
            type="number"
            min={0}
            dir="ltr"
            value={line.manual_price ?? ""}
            onChange={(e) => onSetHotel({ manual_price: e.target.value === "" ? null : Number(e.target.value) })}
            className={`${fieldClass} tv-tnum text-center`}
            placeholder="0"
          />
        </label>
        <label className={rowLabelClass}>
          {t("pg.currencyCol")}
          <select
            value={line.manual_currency}
            onChange={(e) => onSetHotel({ manual_currency: e.target.value })}
            className={fieldClass}
          >
            {currencyOptions(countries, line.manual_currency).map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </label>
        {canRemember ? (
          <label className={rowLabelClass}>
            <span className="invisible">.</span>
            <button
              type="button"
              onClick={save}
              disabled={pending || !line.manual_price}
              title={t("pg.rememberRateHint")}
              className={`inline-flex h-11 items-center gap-2 rounded-[10px] px-4 text-[12.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                saved
                  ? "bg-[#0f7a52] text-white"
                  : "border border-[#b7d0c7] bg-white text-[#185045] hover:bg-[#f0f7f4]"
              }`}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : saved ? (
                <Check className="size-4" />
              ) : (
                <Save className="size-4" />
              )}
              {saved ? t("pg.rateSaved") : t("save")}
            </button>
          </label>
        ) : null}
      </div>

      {/* Shown only when it DISAGREES with the box — repeating a number the
          agent is already looking at is noise. */}
      {differs ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] font-semibold text-[#93aaa3]">
          {t("pg.lastSavedRate")}
          <DirText dir="ltr" className="tv-tnum font-bold text-[#557d78]">
            {`${remembered.price} ${remembered.currency}`}
          </DirText>
          <button
            type="button"
            onClick={() => onSetHotel({ manual_price: remembered.price, manual_currency: remembered.currency })}
            className="rounded-full border border-[#b7d0c7] px-2.5 py-0.5 text-[11px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
          >
            {t("pg.useLastRate")}
          </button>
        </p>
      ) : null}
    </div>
  );
}
