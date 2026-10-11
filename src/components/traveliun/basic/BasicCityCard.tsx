"use client";

import { useState, type ReactNode } from "react";
import { BedDouble, Loader2, Search, Trash2, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import { getDraft } from "@/lib/data/drafts";
import { searchHotelsForCity, selectHotelRate, type HotelOption, type HotelRateOption } from "@/lib/data/hotel-search";
import {
  BOARD_LABEL_KEYS,
  BOARD_TYPES,
  currencyOptions,
  findLookupCountry,
  resizeRooms,
  withRooms,
  type DraftData,
  type DraftHotel,
  type DraftRoomSpec,
  type GeneratorLookups,
} from "@/lib/offer/draft-types";
import type { BasicCity } from "@/lib/offer/basic";
import type { BoardType } from "@/lib/types";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { fieldClass } from "../generator/stage-props";
import { suppliersFor } from "../generator/SupplierPrice";
import { useBasicLabels } from "./labels";

const label = "grid gap-1 text-[11px] font-bold text-[#557d78]";
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * One city: its nights and tours in the header, its hotel underneath, and the
 * flight that brings the group here (passed in by the editor, which knows the
 * order of the legs).
 */
export function BasicCityCard({
  index,
  city,
  dayFrom,
  dayTo,
  draftId,
  data,
  lookups,
  flush,
  replace,
  onNights,
  onTours,
  onHotel,
  onRemove,
  children,
}: {
  index: number;
  city: BasicCity;
  dayFrom: number;
  dayTo: number;
  draftId: string;
  data: DraftData;
  lookups: GeneratorLookups;
  flush: () => Promise<void>;
  replace: (data: DraftData) => void;
  onNights: (nights: number) => void;
  onTours: (tours: number) => void;
  onHotel: (line: DraftHotel) => void;
  onRemove: () => void;
  children?: ReactNode;
}) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const line = data.hotels.find((h) => h.city_name === city.city_name);
  const hotels = findLookupCountry(lookups.countries, data.trip.country)?.cities.find((c) => c.name === city.city_name)?.hotels ?? [];
  const roomNames = [
    ...new Set(
      lookups.roomTypes.filter((r) => !line?.hotel_id || r.hotel_id === line.hotel_id || r.hotel_id === null).map((r) => r.name.trim()),
    ),
  ].filter(Boolean);
  const nights = Math.max(city.nights, 1);
  const room = line?.rooms[0];
  // a hotel taken from a supplier rate is not in our catalogue list — still show its name
  const outside = line?.hotel_name && !hotels.some((h) => h.id === line.hotel_id) ? (line.hotel_id ?? "__current") : null;
  const perNight = room?.price != null ? Math.round((room.price / nights) * 100) / 100 : null;

  /** Basic books its rooms alike: one room type, one board, one nightly rate for all of them. */
  function setRooms(slice: Partial<DraftRoomSpec>) {
    if (!line) return;
    onHotel(withRooms({ ...line, sourcing: null }, line.rooms.map((r) => ({ ...r, ...slice }))));
  }

  return (
    <article className="overflow-hidden rounded-[16px] border border-[#d8e6e0] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <header className="flex flex-wrap items-center gap-2 bg-[#eef5f2] px-3.5 py-2.5">
        <span className="flex size-7 items-center justify-center rounded-full bg-[#185045] text-[12px] font-extrabold text-white">
          {index + 1}
        </span>
        <h3 className="text-[14px] font-extrabold text-[#0f3d38]">{city.city_name}</h3>
        <span className="tv-tnum text-[11.5px] font-bold text-[#557d78]">
          {tx("dayRange", { from: dayFrom, to: dayTo })}
          {city.check_in ? (
            <>
              {" · "}
              <DirText>{`${city.check_in} → ${city.check_out}`}</DirText>
            </>
          ) : null}
        </span>
        <div className="ms-auto flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[#185045]">
            {tx("nights")}
            <select value={city.nights} onChange={(e) => onNights(Number(e.target.value))} className="h-8 rounded-[8px] border border-[#cfe0d9] bg-white px-1.5 text-[12px] font-bold">
              {range(1, 30).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[#185045]">
            {tx("tours")}
            <select value={city.tours ?? 0} onChange={(e) => onTours(Number(e.target.value))} className="h-8 rounded-[8px] border border-[#cfe0d9] bg-white px-1.5 text-[12px] font-bold">
              {range(0, Math.max(city.nights - 1, 0)).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onRemove} aria-label={tx("removeCity")} className="rounded-[8px] p-1.5 text-[#c43d3d] hover:bg-[#fff1f1]">
            <Trash2 className="size-4" />
          </button>
        </div>
      </header>

      <div className="space-y-3 p-3.5">
        {children}

        {line ? (
          <div className="rounded-[12px] border border-[#d6e6ef] bg-[#f6fafc] p-3">
            <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-extrabold text-[#2f5d7a]">
              <BedDouble className="size-3.5" />
              {tx("hotel")}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-[2fr_1.3fr_1fr_0.6fr_1fr_0.8fr_1.3fr]">
              <label className={label}>
                {tx("hotel")}
                <select
                  value={outside ?? line.hotel_id ?? ""}
                  onChange={(e) => {
                    const h = hotels.find((x) => x.id === e.target.value);
                    onHotel(
                      withRooms(
                        { ...line, hotel_id: h?.id ?? null, hotel_name: h?.name ?? "", hotel_name_en: "", sourcing: null },
                        // a room type belongs to its hotel: the old hotel's id must not follow
                        line.rooms.map((r) => ({ ...r, room_type_id: null })),
                      ),
                    );
                  }}
                  className={fieldClass}
                >
                  <option value="">{tx("choose")}</option>
                  {outside ? <option value={outside}>{line.hotel_name}</option> : null}
                  {hotels.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                      {h.stars ? ` ${"★".repeat(h.stars)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                {tx("roomType")}
                <input
                  list={`basic-rooms-${index}`}
                  value={room?.room_type_name ?? ""}
                  onChange={(e) => setRooms({ room_type_name: e.target.value, room_type_id: null })}
                  className={fieldClass}
                />
                <datalist id={`basic-rooms-${index}`}>
                  {roomNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </label>
              <label className={label}>
                {tx("board")}
                <select
                  value={room?.board_type ?? ""}
                  onChange={(e) => setRooms({ board_type: (e.target.value || null) as BoardType | null })}
                  className={fieldClass}
                >
                  <option value="">{tx("choose")}</option>
                  {BOARD_TYPES.map((b) => (
                    <option key={b} value={b}>{t(BOARD_LABEL_KEYS[b])}</option>
                  ))}
                </select>
              </label>
              <label className={label}>
                {tx("rooms")}
                <select
                  value={line.rooms.length}
                  onChange={(e) => onHotel(resizeRooms(line, Number(e.target.value)))}
                  className={fieldClass}
                >
                  {range(1, 10).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label className={label}>
                {tx("perNight")}
                <input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={line.sourcing ? "" : perNight ?? ""}
                  placeholder={line.sourcing ? "—" : "0"}
                  onChange={(e) =>
                    setRooms({ price: e.target.value === "" ? null : Math.round(Number(e.target.value) * nights * 100) / 100 })
                  }
                  className={`${fieldClass} tv-tnum text-center`}
                />
              </label>
              <label className={label}>
                {tx("currency")}
                <select
                  value={line.manual_currency}
                  onChange={(e) => onHotel({ ...line, manual_currency: e.target.value })}
                  className={fieldClass}
                >
                  {currencyOptions(lookups.countries, line.manual_currency).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              {/* who the room was bought from — internal, never on the client document */}
              <label className={label}>
                {t("pg.supplierLabel")}
                <select value={line.supplier ?? ""} onChange={(e) => onHotel({ ...line, supplier: e.target.value })} className={fieldClass}>
                  <option value="">{tx("choose")}</option>
                  {suppliersFor(lookups, "فنادق").map((s) => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-[#2f5d7a]">
              {line.sourcing ? (
                <span className="rounded-full bg-[#e5f1f8] px-2.5 py-1">
                  {tx("fromSupplier", { total: line.sourcing.sell_base.toLocaleString("en-US") })} · {line.sourcing.room_name}
                </span>
              ) : room?.price != null ? (
                <span className="tv-tnum rounded-full bg-[#e5f1f8] px-2.5 py-1">
                  {tx("stayTotal", {
                    total: `${line.rooms.reduce((s, r) => s + (r.price ?? 0), 0).toLocaleString("en-US")} ${line.manual_currency}`,
                  })}
                </span>
              ) : null}
              <LiveRates draftId={draftId} cityName={city.city_name} line={line} flush={flush} replace={replace} />
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

/**
 * «Use rate» from the company's system: ask the connected suppliers for this
 * city and these dates, show the cheapest rooms, and take one onto the line —
 * through selectHotelRate, which re-fetches it live and prices it with the
 * markup rules exactly as the full generator does.
 */
function LiveRates({
  draftId,
  cityName,
  line,
  flush,
  replace,
}: {
  draftId: string;
  cityName: string;
  line: DraftHotel;
  flush: () => Promise<void>;
  replace: (data: DraftData) => void;
}) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<HotelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function search() {
    setOpen(true);
    setResults(null);
    setError(null);
    // the server reads the stay's dates from the saved draft
    await flush();
    const res = await searchHotelsForCity(draftId, cityName, undefined, line.id, { hotel_name: line.hotel_name || null });
    if (res.ok) setResults(res.hotels.filter((h) => h.rates.length > 0).slice(0, 8));
    else setError(t(res.error));
  }

  async function use(hotel: HotelOption, rate: HotelRateOption) {
    setBusy(rate.key);
    const res = await selectHotelRate(draftId, cityName, hotel.source, hotel.id, rate.key, line.id);
    if (res.ok) {
      const fresh = await getDraft(draftId);
      if (fresh) replace(fresh.data);
      setOpen(false);
    } else setError(t(res.error));
    setBusy(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void search()}
        className="ms-auto inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[#2f5d7a] px-3 text-[11.5px] font-bold text-white hover:bg-[#244b63]"
      >
        <Search className="size-3.5" />
        {tx("liveRates")}
      </button>
      {open ? (
        <div className="basis-full rounded-[12px] border border-[#cfe0e9] bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12px] font-extrabold text-[#2f5d7a]">{tx("liveRates")} — {cityName}</p>
            <button type="button" onClick={() => setOpen(false)} aria-label={tx("close")} className="rounded-[8px] p-1 text-[#557d78] hover:bg-[#f2f7f5]">
              <X className="size-4" />
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-[12px] font-bold text-[#c22850]">{error}</p>
          ) : results === null ? (
            <p className="inline-flex items-center gap-2 text-[12px] font-bold text-[#557d78]">
              <Loader2 className="size-4 animate-spin" />
              {tx("searching")}
            </p>
          ) : results.length === 0 ? (
            <p className="text-[12px] font-bold text-[#93aaa3]">{tx("noRates")}</p>
          ) : (
            <ul className="divide-y divide-[#edf3f0]">
              {results.flatMap((hotel) =>
                hotel.rates.slice(0, 2).map((rate) => (
                  <li key={rate.key} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-extrabold text-[#0f3d38]">{hotel.name}</span>
                      <span className="block truncate text-[11px] font-semibold text-[#78948f]">
                        {rate.room}
                        {rate.board ? ` · ${t(BOARD_LABEL_KEYS[rate.board])}` : ""}
                        {rate.refundable ? " · ✓" : ""}
                      </span>
                    </span>
                    <span className="tv-tnum text-end">
                      <span className="block text-[13px] font-extrabold text-[#0f7a52]">
                        <DirText>{`${rate.per_night.toLocaleString("en-US")} ${rate.currency}`}</DirText> {tx("perNightShort")}
                      </span>
                      <span className="block text-[10.5px] font-bold text-[#93aaa3]">
                        <DirText>{`${rate.total.toLocaleString("en-US")} ${rate.currency}`}</DirText>
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy !== null || rate.blocked}
                      onClick={() => void use(hotel, rate)}
                      className="inline-flex h-8 items-center gap-1 rounded-[9px] bg-[#0f7a52] px-3 text-[11.5px] font-bold text-white disabled:opacity-50"
                    >
                      {busy === rate.key ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      {tx("useRate")}
                    </button>
                  </li>
                )),
              )}
            </ul>
          )}
        </div>
      ) : null}
    </>
  );
}
