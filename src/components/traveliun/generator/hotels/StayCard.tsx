"use client";

import { Trash2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  BOARD_LABEL_KEYS,
  BOARD_TYPES,
  resizeRooms,
  roomTypeNames,
  withRooms,
  type DraftHotel,
  type DraftRoomSpec,
  type LookupCountry,
  type LookupRoomType,
} from "@/lib/offer/draft-types";
import type { HotelOption, HotelRateOption, SupplierNote } from "@/lib/data/hotel-search";
import type { BoardType } from "@/lib/types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { createRoomTypeOption } from "@/lib/data/catalog-actions";
import { RoomPrice } from "./RoomPrice";
import { currencyOptions } from "@/lib/offer/draft-types";

/** Sentinel option value — never a real room-type name. */
const ADD_ROOM_TYPE = "__add_room_type__";
import { fieldClass } from "../stage-props";
import { HotelPicker, type PickerFilters, type PickerSource } from "./HotelPicker";
import type { SearchBarGuests } from "./HotelSearchBar";
import { StaySummary } from "./StaySummary";
import { usePartnerBrand } from "@/lib/partners/PartnerContext";

const rowLabelClass = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

/**
 * One stay: either what was chosen, or the act of choosing it. Never both.
 *
 * The old card showed the picker AND a permanently-open manual form AND a
 * hotel dropdown simultaneously, which is why the screen read as random — three
 * inputs, all live, none of them labelled as the one that decides the price.
 */
export function StayCard({
  line,
  index,
  count,
  nights,
  checkIn,
  checkOut,
  choosing,
  onChoosing,
  editing,
  onEditing,
  sourceLabel,
  hotelOptions,
  roomTypeOptions,
  countries,
  suppliers,
  canInternal,
  picker,
  onSetLine,
  onSetHotel,
  onRemove,
  onDone,
  onRefresh,
}: {
  line: DraftHotel;
  index: number;
  count: number;
  nights: number;
  checkIn: string | null;
  checkOut: string | null;
  choosing: boolean;
  onChoosing: (open: boolean) => void;
  editing: boolean;
  onEditing: (open: boolean) => void;
  sourceLabel: string;
  hotelOptions: { id: string; name: string; stars: number | null }[];
  roomTypeOptions: LookupRoomType[];
  /** for the price row's currency list. */
  countries: Pick<LookupCountry, "default_currency">[];
  /** the agency's hotel suppliers, for «المزوّد». */
  suppliers: { id: string; name: string }[];
  canInternal: boolean;
  picker: {
    sources: PickerSource[];
    source: string;
    countryName: string;
    onHotelCreated: (hotel: { id: string; name: string; name_en: string | null; stars: number | null }) => void;
    filters: PickerFilters;
    onFilters: (f: PickerFilters) => void;
    onSearch: () => void;
    searching: boolean;
    error: string | null;
    results: HotelOption[] | null;
    notes: SupplierNote[];
    busyKey: string | null;
    onSelect: (hotel: HotelOption, rate: HotelRateOption | null) => void;
    stay: {
      cityName: string;
      checkIn: string | null;
      checkOut: string | null;
      nights: number;
      guests: SearchBarGuests;
      onNights: (n: number) => void;
      onGuests: (g: SearchBarGuests) => void;
      hotelNames: string[];
    };
  };
  onSetLine: (next: DraftHotel) => void;
  onSetHotel: (slice: Partial<DraftHotel>) => void;
  onRemove: () => void;
  /** This stay is finished — the card closes and the next one opens. */
  onDone?: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTraveliunUI();
  const partner = usePartnerBrand();
  const chosen = Boolean(line.hotel_name.trim());

  return (
    <div className="rounded-[11px] border border-[#e2ebe7] bg-white p-3">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-extrabold text-[#185045]">
            {count > 1 ? `الفندق ${index + 1}` : "الفندق"}
          </span>
          {/* While a hotel is being searched for, the nights live in the search
              bar beside the two dates; here they would be a second copy. */}
          {!choosing ? (
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-[#557d78]">
              ليالٍ
              <input
                type="number"
                min={0}
                dir="ltr"
                value={line.nights || nights}
                onChange={(e) => onSetHotel({ nights: Math.max(0, Number(e.target.value)) })}
                className={`${fieldClass} tv-tnum h-8 w-16 text-center`}
              />
            </label>
          ) : null}
          {checkIn && checkOut ? (
            <span className="tv-tnum text-[11px] font-semibold text-[#93aaa3]">
              <DirText dir="ltr">{`${checkIn} → ${checkOut}`}</DirText>
            </span>
          ) : null}
        </div>
        {count > 1 ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t("delete")}
            className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#f2c7c7] text-[#c43d3d] hover:bg-[#fff1f1]"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>

      {chosen && !choosing ? (
        <StaySummary
          line={line}
          nights={nights}
          sourceLabel={sourceLabel}
          canInternal={canInternal}
          onEdit={() => onEditing(!editing)}
          onChange={() => {
            // A supplier rate is priced for the hotel it came from; swapping the
            // hotel voids it, and the agent should know that before the price
            // vanishes from the card.
            if (line.sourcing && !window.confirm("تغيير الفندق سيُلغي السعر المسحوب من المورّد. متابعة؟")) return;
            onChoosing(true);
          }}
          onRefresh={onRefresh}
        />
      ) : (
        <HotelPicker {...picker} />
      )}

      {/* Details — the same fields as before, now opened deliberately. */}
      {chosen && !choosing && editing ? (
        <div className="mt-2.5 rounded-[10px] border border-[#e7f0ec] bg-[#f8fbf9] p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={rowLabelClass}>
              {t("pg.hotelNameEn")}
              <input
                dir="ltr"
                value={line.hotel_name_en}
                onChange={(e) => onSetHotel({ hotel_name_en: e.target.value })}
                className={`${fieldClass} text-start`}
                placeholder="Hotel name in English"
              />
            </label>
            <label className={rowLabelClass}>
              {t("pg.roomsCount")}
              <input
                type="number"
                min={1}
                dir="ltr"
                value={line.rooms_count}
                onChange={(e) => onSetLine(resizeRooms(line, Number(e.target.value)))}
                className={`${fieldClass} tv-tnum text-center`}
              />
            </label>
          </div>

          <div className="mt-3 space-y-2">
            {line.rooms.map((room, roomIndex) => (
              <RoomRow
                key={roomIndex}
                room={room}
                index={roomIndex}
                single={line.rooms.length === 1}
                roomTypeOptions={roomTypeOptions}
                currency={line.manual_currency || "SAR"}
                priceable={!line.sourcing}
                nights={line.nights || nights}
                hotelId={line.hotel_id}
                onChange={(slice) =>
                  onSetLine(withRooms(line, line.rooms.map((r, i) => (i === roomIndex ? { ...r, ...slice } : r))))
                }
              />
            ))}
          </div>

          {/* The price is OURS only when typed: a supplier rate is a quote we
              were given. Typed prices are per room for the whole stay (above);
              here is what they are in, and who the stay was booked through. */}
          {!line.sourcing ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-[130px_minmax(0,1fr)]">
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
              {/* our suppliers are not a partner's to see or pick */}
              {partner ? null : (
              <label className={rowLabelClass}>
                {t("pg.supplierLabel")}
                <select
                  value={line.supplier ?? ""}
                  onChange={(e) => onSetHotel({ supplier: e.target.value })}
                  className={fieldClass}
                >
                  <option value="">{t("pg.chooseSupplier")}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                  {line.supplier && !suppliers.some((s) => s.name === line.supplier) ? (
                    <option value={line.supplier}>{line.supplier}</option>
                  ) : null}
                </select>
              </label>
              )}
            </div>
          ) : null}
          {onDone ? (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={onDone}
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439]"
              >
                {t("pg.stayDone")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One room of a hotel line: its type and what it includes.
 *
 * A second room is often a DIFFERENT product — the driver's — which is booked
 * and then never labelled as such.
 */
function RoomRow({
  room,
  index,
  single,
  roomTypeOptions,
  currency,
  priceable,
  nights,
  hotelId,
  onChange,
}: {
  room: DraftRoomSpec;
  index: number;
  single: boolean;
  roomTypeOptions: LookupRoomType[];
  currency: string;
  /** false for a supplier rate — that price is the stay's, not this room's. */
  priceable: boolean;
  /** the nights this room is booked for — its price is the total for them. */
  nights: number;
  hotelId: string | null;
  onChange: (slice: Partial<DraftRoomSpec>) => void;
}) {
  const { t } = useTraveliunUI();
  const names = roomTypeNames(roomTypeOptions);

  /**
   * Name a room type the catalogue does not have, without leaving the package.
   *
   * It goes into the agency's list, global, so the next programme finds it —
   * a one-off typed into this draft would be invisible to everyone else and
   * spelled differently the next time.
   */
  async function addRoomType() {
    const typed = window.prompt(t("pg.addRoomType"))?.trim();
    if (!typed) return;
    let result = await createRoomTypeOption(typed);
    if (!result.ok && result.error === "pg.err.didYouMean") {
      const suggestion = result.suggestion;
      result = window.confirm(t("pg.err.didYouMean", { name: suggestion, typed }))
        ? { ok: true, name: suggestion }
        : await createRoomTypeOption(typed, undefined, true);
    }
    if (!result.ok) return;
    onChange({ room_type_id: null, room_type_name: result.name });
  }

  return (
    <div className="grid gap-3 rounded-[10px] border border-[#e7f0ec] bg-white p-2.5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_200px] sm:items-start">
      <span className="self-center rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11.5px] font-extrabold text-[#185045]">
        {single ? t("pg.roomOne") : t("pg.roomN", { n: index + 1 })}
      </span>
      <label className={rowLabelClass}>
        {t("pg.roomType")}
        <select
          // keyed by NAME: a room can carry a type inherited from the trip
          // default before any hotel was picked, and an id-keyed select would
          // show that as blank.
          value={room.room_type_name}
          onChange={(e) => {
            const name = e.target.value;
            if (name === ADD_ROOM_TYPE) {
              void addRoomType();
              return;
            }
            const rt = roomTypeOptions.find((o) => o.name === name) ?? null;
            const slice: Partial<DraftRoomSpec> = { room_type_id: rt?.id ?? null, room_type_name: name };
            if (room.board_type === null && rt?.default_board) slice.board_type = rt.default_board;
            onChange(slice);
          }}
          className={fieldClass}
        >
          <option value="">{t("pg.chooseRoomType")}</option>
          {names.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
          {room.room_type_name && !names.includes(room.room_type_name) ? (
            <option value={room.room_type_name}>{room.room_type_name}</option>
          ) : null}
          {/* Chosen like any other option, because that is how an agent reaches
              for it — a «+» button beside the select is a second control for
              the same decision. */}
          <option value={ADD_ROOM_TYPE}>+ {t("pg.addRoomType")}</option>
        </select>
      </label>
      <label className={rowLabelClass}>
        {t("pg.board")}
        <select
          value={room.board_type ?? ""}
          onChange={(e) => onChange({ board_type: e.target.value === "" ? null : (e.target.value as BoardType) })}
          className={fieldClass}
        >
          <option value="">{t("pg.chooseBoard")}</option>
          {BOARD_TYPES.map((b) => (
            <option key={b} value={b}>{t(BOARD_LABEL_KEYS[b])}</option>
          ))}
        </select>
      </label>
      {/* Per ROOM, because a file routinely books two different ones — a double
          for the parents and a triple for the children — and one figure for the
          line either overcharged the smaller or undercharged the larger. */}
      {priceable ? (
        <RoomPrice room={room} nights={nights} currency={currency} hotelId={hotelId} onChange={onChange} />
      ) : null}
    </div>
  );
}
