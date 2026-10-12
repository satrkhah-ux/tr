"use client";

import { useState, type ReactNode } from "react";
import { BedDouble, ChevronDown, Loader2, Search, Trash2, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import { getDraft } from "@/lib/data/drafts";
import { searchHotelsForCity, selectHotelRate, type HotelOption, type HotelRateOption } from "@/lib/data/hotel-search";
import {
  BOARD_LABEL_KEYS,
  BOARD_TYPES,
  currencyOptions,
  deriveHotelStays,
  findLookupCountry,
  resizeRooms,
  withRooms,
  type DraftData,
  type DraftHotel,
  type DraftRoomSpec,
  type GeneratorLookups,
} from "@/lib/offer/draft-types";
import {
  baseRoomName,
  changeRoom,
  cityLines,
  clearRoomChange,
  extraBeds,
  renameRooms,
  withExtraBeds,
  type BasicCity,
} from "@/lib/offer/basic";
import type { BoardType } from "@/lib/types";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { suppliersFor } from "../generator/SupplierPrice";
import { basicField, basicLabel } from "./styles";
import { nightsText, useBasicLabels } from "./labels";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const money = (n: number) => Math.round(n * 100) / 100;

/**
 * One city: its nights and tours in the header, then its hotel on ONE row —
 * the hotel, the room, what the stay costs. Everything the trip already said
 * (the dates, the rooms, the meals, the currency) is filled in for the agent
 * and kept under «معلومات إضافية», with the extra bed and a room change.
 */
export function BasicCityCard({
  index,
  city,
  dayFrom,
  draftId,
  data,
  lookups,
  hotelsOn,
  toursOn,
  hop,
  flush,
  replace,
  onNights,
  onTours,
  onLines,
  onSlice,
  onRemove,
}: {
  index: number;
  city: BasicCity;
  dayFrom: number;
  draftId: string;
  data: DraftData;
  lookups: GeneratorLookups;
  hotelsOn: boolean;
  toursOn: boolean;
  /** how the group gets here from the previous city, when the trip moves more than one way. */
  hop?: ReactNode;
  flush: () => Promise<void>;
  replace: (data: DraftData) => void;
  onNights: (nights: number) => void;
  onTours: (tours: number) => void;
  /** replace these hotel lines (matched by id) — several at once, from one change. */
  onLines: (lines: DraftHotel[]) => void;
  onSlice: (slice: Partial<DraftData>) => void;
  onRemove: () => void;
}) {
  const tx = useBasicLabels();
  const { t, language } = useTraveliunUI();
  const [more, setMore] = useState(false);
  const lines = cityLines(data.hotels, city.city_name);
  const [main, change] = lines;
  const stays = deriveHotelStays(data.cities, data.hotels).filter((s) => s.city_name === city.city_name);
  const mainNights = Math.max(stays[0]?.nights ?? city.nights, 1);
  const changeNights = Math.max(stays[1]?.nights ?? 0, 1);
  const hotels =
    findLookupCountry(lookups.countries, city.country || data.trip.country)?.cities.find((c) => c.name === city.city_name)?.hotels ?? [];
  const roomNames = [
    ...new Set(
      lookups.roomTypes.filter((r) => !main?.hotel_id || r.hotel_id === main.hotel_id || r.hotel_id === null).map((r) => r.name.trim()),
    ),
  ].filter(Boolean);
  const room = main?.rooms[0];
  // a hotel taken from a supplier rate is not in our catalogue list — still show its name
  const outside = main?.hotel_name && !hotels.some((h) => h.id === main.hotel_id) ? (main.hotel_id ?? "__current") : null;

  /** Basic books a stay's rooms alike: one room type, one board, one price for each of them. */
  const setRooms = (line: DraftHotel, slice: Partial<DraftRoomSpec>) =>
    withRooms({ ...line, sourcing: null }, line.rooms.map((r) => ({ ...r, ...slice })));
  /** The same answer for every stay of this city — one hotel, the room changes inside it. */
  const allLines = (fn: (line: DraftHotel) => DraftHotel) => onLines(lines.map(fn));

  const priceInput = (line: DraftHotel, nights: number, ariaLabel: string) => {
    const price = line.rooms[0]?.price;
    return (
      <span className="grid gap-0.5">
        <input
          type="number"
          min={0}
          dir="ltr"
          aria-label={ariaLabel}
          value={line.sourcing ? "" : (price ?? "")}
          placeholder={line.sourcing ? "—" : "0"}
          onChange={(e) => onLines([setRooms(line, { price: e.target.value === "" ? null : Number(e.target.value) })])}
          className={`${basicField} tv-tnum text-center`}
        />
        {price != null && !line.sourcing ? (
          <span className="tv-tnum text-[10.5px] font-bold text-[#0f7a52]">
            {tx("perNightIs", { price: `${money(price / nights).toLocaleString("en-US")} ${line.manual_currency}` })}
          </span>
        ) : null}
      </span>
    );
  };

  return (
    <article className="overflow-hidden rounded-[14px] border border-[#d8e6e0] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <header className="flex flex-wrap items-center gap-2 bg-[#eef5f2] px-3 py-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-[#185045] text-[11px] font-extrabold text-white">{index + 1}</span>
        <h3 className="text-[13.5px] font-extrabold text-[#0f3d38]">{city.city_name}</h3>
        {city.country ? <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold text-[#557d78]">{city.country}</span> : null}
        {hop}
        <div className="ms-auto flex items-center gap-2">
          <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#185045]">
            {tx("nights")}
            <select value={city.nights} onChange={(e) => onNights(Number(e.target.value))} className="h-7 rounded-[7px] border border-[#cfe0d9] bg-white px-1 text-[12px] font-bold">
              {range(1, 30).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          {toursOn ? (
            <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#185045]">
              {tx("tours")}
              <select value={city.tours ?? 0} onChange={(e) => onTours(Number(e.target.value))} className="h-7 rounded-[7px] border border-[#cfe0d9] bg-white px-1 text-[12px] font-bold">
                {range(0, Math.max(city.nights - 1, 0)).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" onClick={onRemove} aria-label={tx("removeCity")} className="rounded-[7px] p-1 text-[#c43d3d] hover:bg-[#fff1f1]">
            <Trash2 className="size-4" />
          </button>
        </div>
      </header>

      {hotelsOn && main ? (
        <div className="p-3">
          <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[2fr_1.4fr_1fr_auto]">
            <label className={`${basicLabel} col-span-2 sm:col-span-1`}>
              <span className="inline-flex items-center gap-1">
                <BedDouble className="size-3.5" />
                {tx("hotel")}
              </span>
              <select
                value={outside ?? main.hotel_id ?? ""}
                onChange={(e) => {
                  const h = hotels.find((x) => x.id === e.target.value);
                  allLines((line) =>
                    withRooms(
                      { ...line, hotel_id: h?.id ?? null, hotel_name: h?.name ?? "", hotel_name_en: "", sourcing: null },
                      // a room type belongs to its hotel: the old hotel's id must not follow
                      line.rooms.map((r) => ({ ...r, room_type_id: null })),
                    ),
                  );
                }}
                className={basicField}
              >
                <option value="">{tx("choose")}</option>
                {outside ? <option value={outside}>{main.hotel_name}</option> : null}
                {hotels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                    {h.stars ? ` ${"★".repeat(h.stars)}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={basicLabel}>
              {tx("roomType")}
              <input
                list={`basic-rooms-${index}`}
                value={baseRoomName(room?.room_type_name ?? "")}
                onChange={(e) => onLines([renameRooms({ ...main, sourcing: null }, e.target.value)])}
                className={basicField}
              />
            </label>
            <label className={basicLabel}>
              {tx("stayPrice", { n: nightsText(mainNights, language) })}
              {priceInput(main, mainNights, tx("stayPrice", { n: nightsText(mainNights, language) }))}
            </label>
            <div className="col-span-2 flex items-end gap-1.5 self-stretch sm:col-span-1">
              <LiveRates draftId={draftId} cityName={city.city_name} line={main} sources={lookups.hotelSources} flush={flush} replace={replace} />
              <button
                type="button"
                onClick={() => setMore((v) => !v)}
                aria-expanded={more}
                className="inline-flex h-9 items-center gap-1 rounded-[8px] border border-[#cfe0d9] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
              >
                {tx("moreInfo")}
                <ChevronDown className={`size-3.5 transition-transform ${more ? "rotate-180" : ""}`} />
              </button>
            </div>
          </div>
          <datalist id={`basic-rooms-${index}`}>
            {roomNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>

          {main.sourcing ? (
            <p className="mt-2 inline-block rounded-full bg-[#e5f1f8] px-2.5 py-1 text-[11px] font-bold text-[#2f5d7a]">
              {tx("fromSupplier", { total: main.sourcing.sell_base.toLocaleString("en-US") })} · {main.sourcing.room_name}
            </p>
          ) : null}

          {more ? (
            <div className="mt-2.5 space-y-2.5 rounded-[11px] border border-dashed border-[#d6e6ef] bg-[#f8fbfc] p-2.5">
              {/* what the trip already decided — shown, never asked again */}
              <p className="tv-tnum flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold text-[#557d78]">
                <span>{tx("dayRange", { from: dayFrom, to: dayFrom + city.nights })}</span>
                {stays.map((s) =>
                  s.check_in ? (
                    <DirText key={s.line.id}>{tx("stayDates", { in: s.check_in, out: s.check_out ?? "" })}</DirText>
                  ) : null,
                )}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <label className={basicLabel}>
                  {tx("rooms")}
                  <select value={main.rooms.length} onChange={(e) => allLines((line) => resizeRooms(line, Number(e.target.value)))} className={basicField}>
                    {range(1, 10).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label className={basicLabel}>
                  {tx("board")}
                  <select
                    value={room?.board_type ?? ""}
                    onChange={(e) => allLines((line) => setRooms(line, { board_type: (e.target.value || null) as BoardType | null }))}
                    className={basicField}
                  >
                    <option value="">{tx("choose")}</option>
                    {BOARD_TYPES.map((b) => (
                      <option key={b} value={b}>{t(BOARD_LABEL_KEYS[b])}</option>
                    ))}
                  </select>
                </label>
                <label className={basicLabel}>
                  {tx("extraBed")}
                  <select value={extraBeds(main)} onChange={(e) => allLines((line) => withExtraBeds(line, Number(e.target.value)))} className={basicField}>
                    <option value={0}>{tx("none")}</option>
                    {range(1, main.rooms.length).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label className={basicLabel}>
                  {tx("currency")}
                  <select value={main.manual_currency} onChange={(e) => allLines((line) => ({ ...line, manual_currency: e.target.value }))} className={basicField}>
                    {currencyOptions(lookups.countries, main.manual_currency).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                {/* who the room was bought from — internal, never on the client document */}
                <label className={basicLabel}>
                  {t("pg.supplierLabel")}
                  <select value={main.supplier ?? ""} onChange={(e) => allLines((line) => ({ ...line, supplier: e.target.value }))} className={basicField}>
                    <option value="">{tx("choose")}</option>
                    {suppliersFor(lookups, "فنادق").map((s) => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              {city.nights > 1 ? (
                <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[1fr_1.4fr_1fr]">
                  <label className={basicLabel}>
                    {tx("roomChange")}
                    <select
                      value={change ? mainNights : ""}
                      onChange={(e) =>
                        onSlice(
                          e.target.value === ""
                            ? clearRoomChange(data, city.city_name)
                            : changeRoom(data, city.city_name, Number(e.target.value), change ? baseRoomName(change.rooms[0]?.room_type_name ?? "") : ""),
                        )
                      }
                      className={basicField}
                    >
                      <option value="">{tx("none")}</option>
                      {range(1, city.nights - 1).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  {change ? (
                    <>
                      <label className={basicLabel}>
                        {tx("newRoom")}
                        <input
                          list={`basic-rooms-${index}`}
                          value={baseRoomName(change.rooms[0]?.room_type_name ?? "")}
                          onChange={(e) => onLines([renameRooms(change, e.target.value)])}
                          className={basicField}
                        />
                      </label>
                      <label className={basicLabel}>
                        {tx("stayPrice", { n: nightsText(changeNights, language) })}
                        {priceInput(change, changeNights, tx("stayPrice", { n: nightsText(changeNights, language) }))}
                      </label>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
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
  sources,
  flush,
  replace,
}: {
  draftId: string;
  cityName: string;
  line: DraftHotel;
  sources: GeneratorLookups["hotelSources"];
  flush: () => Promise<void>;
  replace: (data: DraftData) => void;
}) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<HotelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Not every answer is a live price: with no supplier connected the system falls
  // back to invented rates, and the Almosafer demo replays a July snapshot. Both
  // must say so on every row, or an agent quotes a client a price nobody sells.
  // «mock» is the fallback that has no supplier row, so it is never in `sources`.
  const isDemo = (code: string) => code === "mock" || sources.some((s) => s.code === code && s.demo);
  const sourceName = (code: string) => sources.find((s) => s.code === code)?.name ?? code;

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
        title={tx("liveRates")}
        className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#2f5d7a] px-2.5 text-[11.5px] font-bold text-white hover:bg-[#244b63]"
      >
        <Search className="size-3.5" />
        <span className="max-xl:hidden">{tx("liveRates")}</span>
      </button>
      {open ? (
        <div className="fixed inset-x-3 top-24 z-40 mx-auto max-h-[70vh] max-w-xl overflow-y-auto rounded-[12px] border border-[#cfe0e9] bg-white p-3 shadow-[0_16px_40px_rgba(0,60,58,0.2)]">
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
            <>
              {results.some((h) => isDemo(h.source)) ? (
                <p role="alert" className="mb-2 rounded-[9px] border border-[#f2d39a] bg-[#fff6e4] px-3 py-2 text-[11.5px] font-bold leading-5 text-[#8a5a0c]">
                  {tx("demoRates")}
                </p>
              ) : null}
              <ul className="divide-y divide-[#edf3f0]">
                {results.flatMap((hotel) =>
                  hotel.rates.slice(0, 2).map((rate) => (
                    <li key={rate.key} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-extrabold text-[#0f3d38]">
                          {hotel.name}
                          <span
                            className={`ms-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                              isDemo(hotel.source) ? "bg-[#fff1d6] text-[#a86a10]" : "bg-[#e5f1f8] text-[#2f5d7a]"
                            }`}
                          >
                            {isDemo(hotel.source) ? tx("demoTag") : sourceName(hotel.source)}
                          </span>
                        </span>
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
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
