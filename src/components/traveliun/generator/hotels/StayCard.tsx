"use client";

import { Trash2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  BOARD_LABEL_KEYS,
  BOARD_TYPES,
  CURRENCIES,
  resizeRooms,
  roomTypeNames,
  withRooms,
  type DraftHotel,
  type DraftRoomSpec,
  type LookupRoomType,
} from "@/lib/offer/draft-types";
import type { HotelOption, HotelRateOption, SupplierNote } from "@/lib/data/hotel-search";
import type { BoardType } from "@/lib/types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass } from "../stage-props";
import { HotelPicker, type PickerFilters, type PickerSource } from "./HotelPicker";
import type { SearchBarGuests } from "./HotelSearchBar";
import { StaySummary } from "./StaySummary";

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
  canInternal,
  picker,
  onSetLine,
  onSetHotel,
  onRemove,
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
  canInternal: boolean;
  picker: {
    sources: PickerSource[];
    source: string;
    onSource: (code: string) => void;
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
  onRefresh: () => void;
}) {
  const { t } = useTraveliunUI();
  const chosen = Boolean(line.hotel_name.trim());

  return (
    <div className="rounded-[11px] border border-[#e2ebe7] bg-white p-3">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-extrabold text-[#185045]">
            {count > 1 ? `الفندق ${index + 1}` : "الفندق"}
          </span>
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
        <HotelPicker
          {...picker}
          manual={
            <ManualEntry
              line={line}
              hotelOptions={hotelOptions}
              roomTypeOptions={roomTypeOptions}
              onSetLine={onSetLine}
              onSetHotel={onSetHotel}
              onDone={() => onChoosing(false)}
            />
          }
        />
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
                placeholder="Baku Center Hotel"
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
                onChange={(slice) =>
                  onSetLine(withRooms(line, line.rooms.map((r, i) => (i === roomIndex ? { ...r, ...slice } : r))))
                }
              />
            ))}
          </div>

          {/* The price is editable only when it is OURS to edit. A supplier rate
              is a quote we were given; typing over it would produce a number no
              supplier ever agreed to. */}
          {!line.sourcing ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
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
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The «يدوي» tab: a hotel in neither system, named and priced by hand. */
function ManualEntry({
  line,
  hotelOptions,
  roomTypeOptions,
  onSetLine,
  onSetHotel,
  onDone,
}: {
  line: DraftHotel;
  hotelOptions: { id: string; name: string; stars: number | null }[];
  roomTypeOptions: LookupRoomType[];
  onSetLine: (next: DraftHotel) => void;
  onSetHotel: (slice: Partial<DraftHotel>) => void;
  onDone: () => void;
}) {
  const { t } = useTraveliunUI();

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={rowLabelClass}>
          {t("pg.hotel")}
          <select
            value={line.hotel_name}
            onChange={(e) => {
              const name = e.target.value;
              const match = hotelOptions.find((h) => h.name === name) ?? null;
              const hotelId = match ? match.id : null;
              // room types inherited from the customer stage are NAMES; pin them
              // to this hotel's own rows now that we know the hotel
              const pinned = line.rooms.map((r) => ({
                ...r,
                room_type_id:
                  roomTypeOptions.find(
                    (rt) => (rt.hotel_id === hotelId || rt.hotel_id === null) && rt.name === r.room_type_name,
                  )?.id ?? null,
              }));
              onSetLine(withRooms({ ...line, hotel_name: name, hotel_id: hotelId }, pinned));
            }}
            className={fieldClass}
          >
            <option value="">{t("pg.chooseHotel")}</option>
            {hotelOptions.map((option) => (
              <option key={option.id} value={option.name}>{option.name}</option>
            ))}
            {line.hotel_name && !hotelOptions.some((h) => h.name === line.hotel_name) ? (
              <option value={line.hotel_name}>{line.hotel_name}</option>
            ) : null}
          </select>
        </label>
        <label className={rowLabelClass}>
          {t("pg.customHotel")}
          <input
            value={line.hotel_id === null ? line.hotel_name : ""}
            onChange={(e) => onSetHotel({ hotel_name: e.target.value, hotel_id: null })}
            className={fieldClass}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
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
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        disabled={!line.hotel_name.trim()}
        onClick={onDone}
        className="justify-self-start rounded-[9px] bg-[#185045] px-4 py-2 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-50"
      >
        اعتمد هذا الفندق
      </button>
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
  onChange,
}: {
  room: DraftRoomSpec;
  index: number;
  single: boolean;
  roomTypeOptions: LookupRoomType[];
  onChange: (slice: Partial<DraftRoomSpec>) => void;
}) {
  const { t } = useTraveliunUI();
  const names = roomTypeNames(roomTypeOptions);

  return (
    <div className="grid gap-3 rounded-[10px] border border-[#e7f0ec] bg-white p-2.5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
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
    </div>
  );
}
