"use client";

import { useState } from "react";
import { Loader2, RefreshCw, Search, Star } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  BOARD_LABEL_KEYS,
  BOARD_TYPES,
  CURRENCIES,
  deriveCityDates,
  findLookupCountry,
  normalizeDraftHotel,
  resizeRooms,
  roomTypeNames,
  withRooms,
  type DraftHotel,
  type DraftRoomSpec,
  type DraftTrip,
  type LookupRoomType,
} from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";
import { getDraft } from "@/lib/data/drafts";
import {
  searchHotelsForCity,
  selectHotelRate,
  type SearchHotel,
  type SearchRate,
  type SupplierNote,
} from "@/lib/data/hotel-search";
import { useRole } from "@/lib/roles/RoleContext";
import type { BoardType } from "@/lib/types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass, sectionClass, type StageFormProps } from "../stage-props";

const rowLabelClass = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

/** Everything on a hotel line EXCEPT the rooms and the scalars mirroring them. */
type HotelScalarSlice = Omit<
  Partial<DraftHotel>,
  "rooms" | "rooms_count" | "room_type_id" | "room_type_name" | "board_type"
>;

/**
 * A city's hotel line starts from the trip defaults the agent entered with the
 * customer — room count, room type and board. Per-city edits happen here on top
 * of that, so the common case (same room everywhere) is zero extra typing.
 */
function defaultLine(cityName: string, trip: DraftTrip): DraftHotel {
  // Every room starts as the trip default: the id is per-hotel and gets resolved
  // by name once a hotel is chosen.
  const room = { room_type_id: null, room_type_name: trip.default_room_type_name, board_type: trip.default_board };
  return normalizeDraftHotel({
    city_name: cityName,
    rooms: Array.from({ length: Math.max(trip.rooms || 1, 1) }, () => ({ ...room })),
    rooms_count: Math.max(trip.rooms || 1, 1),
  });
}

function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(Math.floor((Date.now() - t) / 60000), 0);
}

/**
 * Stage 4 — one hotel line PER CITY. The city + its check-in/check-out/nights come
 * from the schedule engine (read-only here). "بحث الفنادق" queries the enabled
 * suppliers for the city + those dates + occupancy; selecting a rate caches the
 * hotel's STATIC content ONCE and persists the CHOSEN LIVE RATE. Manual entry is
 * still available. Net/margin are permission-gated (pricing.internal).
 */
export function HotelsStage({ draftId, data, patch, replace, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const canInternal = can("pricing.internal");

  const [searchCity, setSearchCity] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchHotel[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [filters, setFilters] = useState({ minStars: 0, board: "", refundableOnly: false, maxPrice: "" });
  const [notes, setNotes] = useState<SupplierNote[]>([]);
  /**
   * Where hotels come from, per city.
   *
   * "internal" is the company's own list — the dropdown below, with a price the
   * agent types. "tbo" is the live supplier. Kept explicit rather than searching
   * everything at once: they are different jobs. The internal list is what we
   * have contracts for; the supplier is live inventory at a live price, and an
   * agent should know which one they are quoting.
   */
  const [source, setSource] = useState<Record<string, "internal" | "tbo">>({});

  const country = findLookupCountry(lookups.countries, data.trip.country);
  /** Live search is impossible without it — say so before the agent presses. */
  const canSearchLive = Boolean(country?.iso2);
  const derivedCities = deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities);

  function lineFor(cityName: string): DraftHotel {
    return data.hotels.find((h) => h.city_name === cityName) ?? defaultLine(cityName, data.trip);
  }

  /**
   * Replace a city's WHOLE line — used whenever rooms[] changes, because the
   * array and its mirrors (rooms_count, room 1's type/board) must move together
   * and only withRooms() is allowed to set them.
   *
   * A supplier rate is priced for a specific room product, so changing the hotel
   * or any room voids it rather than leaving a stale price attached to something
   * the supplier never quoted.
   */
  function setLine(cityName: string, next: DraftHotel) {
    const rebuilt = data.cities.map((city) => {
      const line = lineFor(city.city_name);
      if (city.city_name !== cityName) return line;
      const productChanged =
        next.hotel_name !== line.hotel_name ||
        next.rooms.length !== line.rooms.length ||
        next.rooms.some(
          (r, i) => r.room_type_name !== line.rooms[i]?.room_type_name || r.board_type !== line.rooms[i]?.board_type,
        );
      return productChanged && line.sourcing ? { ...next, sourcing: null } : next;
    });
    patch({ hotels: rebuilt });
  }

  /**
   * Patch the NON-room fields of a city's line. The rooms array and its mirrors
   * are excluded at the type level: writing `board_type` here would change what
   * validation reads on room 1 while rooms[0] still said something else, and the
   * two would disagree silently. Room edits go through setLine + withRooms.
   */
  function setHotel(cityName: string, slice: HotelScalarSlice) {
    const productChanged = "hotel_name" in slice || "hotel_id" in slice || "board_type" in slice || "rooms_count" in slice;
    const rebuilt = data.cities.map((city) => {
      const line = lineFor(city.city_name);
      if (city.city_name !== cityName) return line;
      const next = { ...line, ...slice };
      if (productChanged && line.sourcing) next.sourcing = null;
      return next;
    });
    patch({ hotels: rebuilt });
  }

  async function openSearch(cityName: string) {
    setSearchCity(cityName);
    setResults(null);
    setNotes([]);
    setSearchError(null);
    setFilters({ minStars: 0, board: "", refundableOnly: false, maxPrice: "" });
    setSearching(true);
    const res = await searchHotelsForCity(draftId, cityName, "tbo");
    if (res.ok) {
      setResults(res.hotels);
      setNotes(res.notes);
    } else setSearchError(t(res.error));
    setSearching(false);
  }

  async function choose(cityName: string, hotel: SearchHotel, rate: SearchRate) {
    setSelecting(rate.rate_key);
    const res = await selectHotelRate(draftId, cityName, hotel.supplier, hotel.supplier_hotel_id, rate.rate_key);
    if (res.ok) {
      const fresh = await getDraft(draftId);
      if (fresh) replace(fresh.data);
      setSearchCity(null);
      setResults(null);
    } else {
      setSearchError(t(res.error));
    }
    setSelecting(null);
  }

  function rateMatches(hotel: SearchHotel, rate: SearchRate): boolean {
    if (filters.board && rate.board_type !== filters.board) return false;
    if (filters.refundableOnly && !rate.refundable) return false;
    if (filters.maxPrice && rate.sell > Number(filters.maxPrice)) return false;
    if (filters.minStars && (hotel.star_rating ?? 0) < filters.minStars) return false;
    return true;
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-1 text-base font-extrabold text-[#003c3a]">{t("pg.hotelsTitle")}</h2>
      <p className="mb-4 text-[11.5px] font-semibold text-[#93aaa3]">{t("pg.supplier.searchHint")}</p>

      {data.cities.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#93aaa3]">
          {t("pg.hotelsNeedCities")}
        </p>
      ) : (
        <div className="space-y-3">
          {derivedCities.map((city, index) => {
            const line = lineFor(city.city_name);
            const lookupCity = country?.cities.find((c) => c.name === city.city_name);
            const hotelOptions = lookupCity?.hotels ?? [];
            const roomTypeOptions = lookups.roomTypes.filter((rt) => rt.hotel_id === line.hotel_id || rt.hotel_id === null);
            const isSearching = searchCity === city.city_name;

            return (
              <div key={index} className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-extrabold text-[#003c3a]">{city.city_name || "—"}</h3>
                  <div className="flex items-center gap-2">
                    <p className="tv-tnum text-[11.5px] font-semibold text-[#93aaa3]">
                      {t("pg.cityNights")} <DirText dir="ltr">{city.nights}</DirText>
                      {city.check_in && city.check_out ? (
                        <> {" · "}<DirText dir="ltr">{`${city.check_in} → ${city.check_out}`}</DirText></>
                      ) : null}
                    </p>
                    {/* The source choice. Internal = our own contracted list,
                        priced by hand; TBO = live inventory at a live price. */}
                    <div className="inline-flex overflow-hidden rounded-[9px] border border-[#cfe0d9]">
                      {(["internal", "tbo"] as const).map((key) => {
                        const active = (source[city.city_name] ?? "internal") === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              setSource((s) => ({ ...s, [city.city_name]: key }));
                              if (key === "internal" && isSearching) setSearchCity(null);
                            }}
                            className={`h-8 px-3 text-[11.5px] font-bold transition-colors ${
                              active ? "bg-[#185045] text-white" : "bg-white text-[#557d78] hover:bg-[#f0f7f4]"
                            }`}
                          >
                            {key === "internal" ? "النظام الداخلي" : "TBO"}
                          </button>
                        );
                      })}
                    </div>
                    {(source[city.city_name] ?? "internal") === "tbo" ? (
                      <button
                        type="button"
                        disabled={!canSearchLive}
                        title={canSearchLive ? undefined : "الدولة بلا رمز ISO — لا يمكن البحث لدى المورّد"}
                        onClick={() => (isSearching ? setSearchCity(null) : void openSearch(city.city_name))}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-50"
                      >
                        <Search className="size-3.5" />
                        {t("pg.supplier.searchHotels")}
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Occupancy is NOT re-entered here: it was agreed with the
                    customer on stage 1 and the supplier is asked for exactly
                    that. Shown so the agent can see what is being priced. */}
                {(source[city.city_name] ?? "internal") === "tbo" ? (
                  <p className="tv-tnum mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-[#557d78]">
                    <span>
                      البحث لـ <DirText dir="ltr">{data.trip.adults}</DirText> بالغ
                      {data.trip.children > 0 ? (
                        <> و<DirText dir="ltr">{data.trip.children}</DirText> طفل</>
                      ) : null}{" "}
                      · <DirText dir="ltr">{line.rooms_count}</DirText> غرفة
                    </span>
                    <span className="text-[#93aaa3]">
                      {country?.iso2 ? (
                        <>
                          الدولة <DirText dir="ltr">{country.iso2}</DirText> · جنسية التسعير{" "}
                          <DirText dir="ltr">SA</DirText>
                        </>
                      ) : (
                        <span className="text-[#c22850]">الدولة «{data.trip.country}» بلا رمز ISO في قسم الدول.</span>
                      )}
                    </span>
                  </p>
                ) : null}

                {/* supplier search panel */}
                {isSearching ? (
                  <div className="mb-3 rounded-[10px] border border-[#d6eadf] bg-white p-3">
                    <div className="mb-3 flex flex-wrap items-end gap-2 text-[11.5px] font-bold text-[#185045]">
                      <label className="grid gap-1">
                        {t("pg.supplier.stars")}
                        <select value={filters.minStars} onChange={(e) => setFilters((f) => ({ ...f, minStars: Number(e.target.value) }))} className={`${fieldClass} h-9`}>
                          <option value={0}>{t("pg.supplier.any")}</option>
                          {[3, 4, 5].map((s) => <option key={s} value={s}>{s}+</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1">
                        {t("pg.board")}
                        <select value={filters.board} onChange={(e) => setFilters((f) => ({ ...f, board: e.target.value }))} className={`${fieldClass} h-9`}>
                          <option value="">{t("pg.supplier.allBoards")}</option>
                          {BOARD_TYPES.map((b) => <option key={b} value={b}>{t(BOARD_LABEL_KEYS[b])}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1">
                        {t("pg.supplier.maxPrice")}
                        <input type="number" dir="ltr" value={filters.maxPrice} onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))} className={`${fieldClass} tv-tnum h-9 w-24`} />
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={filters.refundableOnly} onChange={(e) => setFilters((f) => ({ ...f, refundableOnly: e.target.checked }))} className="size-4 accent-[#185045]" />
                        {t("pg.supplier.refundableOnly")}
                      </label>
                    </div>

                    {searching ? (
                      <p className="flex items-center gap-2 py-4 text-[12.5px] font-bold text-[#557d78]"><Loader2 className="size-4 animate-spin" />{t("pg.supplier.searching")}</p>
                    ) : searchError ? (
                      <p className="py-2 text-[12.5px] font-bold text-[#c22850]">{searchError}</p>
                    ) : results && results.length > 0 ? (
                      <div className="space-y-2">
                        {results.map((hotel) => {
                          const rates = hotel.rates.filter((r) => rateMatches(hotel, r));
                          if (rates.length === 0) return null;
                          return (
                            <div key={`${hotel.supplier}-${hotel.supplier_hotel_id}`} className="flex gap-3 rounded-[10px] border border-[#e2ebe7] p-2">
                              {hotel.thumbnail_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={hotel.thumbnail_url} alt="" className="h-20 w-28 shrink-0 rounded-[8px] object-cover" />
                              ) : null}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] font-extrabold text-[#003c3a]">{hotel.name_ar}</span>
                                  {hotel.star_rating ? (
                                    <span className="inline-flex items-center text-[#e0a400]">
                                      {Array.from({ length: hotel.star_rating }).map((_, i) => <Star key={i} className="size-3 fill-current" />)}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-1 space-y-1">
                                  {rates.map((rate) => (
                                    <div key={rate.rate_key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]">
                                      <span className="font-bold text-[#185045]">{rate.room_name}</span>
                                      <span className="rounded-full bg-[#eef4f1] px-2 py-0.5 font-bold text-[#557d78]">{t(BOARD_LABEL_KEYS[rate.board_type])}</span>
                                      <span className={`rounded-full px-2 py-0.5 font-bold ${rate.refundable ? "bg-[#e4f6ef] text-[#10966b]" : "bg-[#fdeef2] text-[#c22850]"}`}>
                                        {rate.refundable ? t("pg.supplier.refundable") : t("pg.supplier.nonRefundable")}
                                      </span>
                                      <span className="tv-tnum font-extrabold text-[#0f3d38]"><DirText dir="ltr">{`${rate.sell} SAR`}</DirText></span>
                                      <button
                                        type="button"
                                        disabled={selecting !== null}
                                        onClick={() => void choose(city.city_name, hotel, rate)}
                                        className="ms-auto inline-flex h-7 items-center gap-1 rounded-[8px] bg-[#185045] px-2.5 text-[11px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
                                      >
                                        {selecting === rate.rate_key ? <Loader2 className="size-3 animate-spin" /> : null}
                                        {t("pg.supplier.select")}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="py-2 text-[12.5px] text-[#93aaa3]">
                        <p>{t("pg.supplier.noResults")}</p>
                        {/* An empty list used to look identical whether the
                            supplier refused us, could not be reached, or the
                            city is genuinely full. Those need different actions. */}
                        {notes.map((n) => (
                          <p key={n.supplier} className="mt-1 text-[11.5px] font-bold">
                            {n.reason === "no_country" ? (
                              <span className="text-[#c22850]">
                                {n.name}: الدولة بلا رمز ISO — أضِفه في قسم الدول ثم أعد البحث.
                              </span>
                            ) : n.reason === "error" ? (
                              <span className="text-[#c22850]">{n.name}: تعذّر الوصول إلى المورّد.</span>
                            ) : n.reason === "nothing" ? (
                              <span className="text-[#a86a10]">
                                {n.name}: لم يُرجع أي غرفة لهذه المدينة والتواريخ — تحقّق من حالة الاتصال في
                                إعدادات المزوّدين.
                              </span>
                            ) : null}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* manual entry grid */}
                <div className="grid gap-3 md:grid-cols-2">
                  <label className={rowLabelClass}>
                    {t("pg.hotel")}
                    <select
                      value={line.hotel_name}
                      onChange={(e) => {
                        const name = e.target.value;
                        const match = hotelOptions.find((h) => h.name === name) ?? null;
                        // the room types inherited from the customer stage are NAMES;
                        // pin them to this hotel's own rows now that we know the hotel
                        const hotelId = match ? match.id : null;
                        const pinned = line.rooms.map((r) => ({
                          ...r,
                          room_type_id:
                            lookups.roomTypes.find(
                              (rt) => (rt.hotel_id === hotelId || rt.hotel_id === null) && rt.name === r.room_type_name,
                            )?.id ?? null,
                        }));
                        setLine(city.city_name, withRooms({ ...line, hotel_name: name, hotel_id: hotelId }, pinned));
                      }}
                      className={fieldClass}
                    >
                      <option value="">{t("pg.chooseHotel")}</option>
                      {hotelOptions.map((option) => <option key={option.id} value={option.name}>{option.name}</option>)}
                      {line.hotel_name && !hotelOptions.some((h) => h.name === line.hotel_name) ? (
                        <option value={line.hotel_name}>{line.hotel_name}</option>
                      ) : null}
                    </select>
                  </label>
                  <label className={rowLabelClass}>
                    {t("pg.customHotel")}
                    <input value={line.hotel_id === null ? line.hotel_name : ""} onChange={(e) => setHotel(city.city_name, { hotel_name: e.target.value, hotel_id: null })} className={fieldClass} />
                  </label>
                  {/* the Latin name a traveller shows a taxi driver */}
                  <label className={rowLabelClass}>
                    {t("pg.hotelNameEn")}
                    <input
                      dir="ltr"
                      value={line.hotel_name_en}
                      onChange={(e) => setHotel(city.city_name, { hotel_name_en: e.target.value })}
                      className={`${fieldClass} text-start`}
                      placeholder="Baku Center Hotel"
                    />
                  </label>
                  <label className={rowLabelClass}>
                    {t("pg.roomsCount")}
                    <input
                      type="number" min={1} dir="ltr"
                      value={line.rooms_count}
                      onChange={(e) => setLine(city.city_name, resizeRooms(line, Number(e.target.value)))}
                      className={`${fieldClass} tv-tnum text-center`}
                    />
                  </label>
                </div>

                {/* ONE block per room: a second room is often a different product
                    (the driver's), and it is booked but never labelled as such. */}
                <div className="mt-3 space-y-2">
                  {line.rooms.map((room, roomIndex) => (
                    <RoomRow
                      key={roomIndex}
                      room={room}
                      index={roomIndex}
                      single={line.rooms.length === 1}
                      roomTypeOptions={roomTypeOptions}
                      onChange={(slice) =>
                        setLine(
                          city.city_name,
                          withRooms(line, line.rooms.map((r, i) => (i === roomIndex ? { ...r, ...slice } : r))),
                        )
                      }
                    />
                  ))}
                </div>

                {/* manual price — used when the supplier search is not the source */}
                {!line.sourcing ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                    <label className={rowLabelClass}>
                      {t("pg.manualPrice")}
                      <input
                        type="number" min={0} dir="ltr"
                        value={line.manual_price ?? ""}
                        onChange={(e) =>
                          setHotel(city.city_name, {
                            manual_price: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className={`${fieldClass} tv-tnum text-center`}
                        placeholder="0"
                      />
                    </label>
                    <label className={rowLabelClass}>
                      {t("pg.currencyCol")}
                      <select
                        value={line.manual_currency}
                        onChange={(e) => setHotel(city.city_name, { manual_currency: e.target.value })}
                        className={fieldClass}
                      >
                        {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
                      </select>
                    </label>
                  </div>
                ) : null}

                {/* selected supplier rate — image, facilities, price, freshness */}
                {line.sourcing ? (
                  <SelectedHotelCard sourcing={line.sourcing} canInternal={canInternal} onRefresh={() => void openSearch(city.city_name)} />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * One room of a hotel line: its type and what it includes.
 *
 * Numbered only when there is more than one — «الغرفة ١» on a single-room stay
 * is noise, but on a two-room stay the number is the only thing distinguishing
 * the family's double from the room quietly booked for the driver.
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
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
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
          {BOARD_TYPES.map((b) => <option key={b} value={b}>{t(BOARD_LABEL_KEYS[b])}</option>)}
        </select>
      </label>
    </div>
  );
}

function SelectedHotelCard({
  sourcing,
  canInternal,
  onRefresh,
}: {
  sourcing: NonNullable<DraftHotel["sourcing"]>;
  canInternal: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTraveliunUI();
  const ago = minutesAgo(sourcing.rate_fetched_at);
  return (
    <div className={`mt-3 rounded-[10px] border p-2.5 text-[11.5px] ${sourcing.blocked ? "border-[#f0c7c7] bg-[#fdeef2]" : "border-[#d6eadf] bg-[#f2fbf6]"}`}>
      <div className="flex gap-3">
        {sourcing.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sourcing.image_url} alt="" className="h-16 w-24 shrink-0 rounded-[8px] object-cover" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-bold text-[#0f3d38]">
            {sourcing.star_rating ? (
              <span className="inline-flex items-center text-[#e0a400]">
                {Array.from({ length: sourcing.star_rating }).map((_, i) => <Star key={i} className="size-3 fill-current" />)}
              </span>
            ) : null}
            <span>{sourcing.room_name}</span>
            <span className="tv-tnum">{t("pg.supplier.sell")}: <DirText dir="ltr">{`${sourcing.sell_base} SAR`}</DirText></span>
            {canInternal ? (
              <>
                <span className="tv-tnum text-[#557d78]">{t("pg.supplier.net")}: <DirText dir="ltr">{`${sourcing.net_base} SAR`}</DirText></span>
                <span className="tv-tnum text-[#557d78]">{t("pg.marginCol")}: <DirText dir="ltr">{sourcing.margin_pct != null ? `${sourcing.margin_pct}%` : "—"}</DirText></span>
              </>
            ) : null}
          </div>
          {sourcing.facilities.length > 0 ? (
            <p className="mt-1 text-[#557d78]"><span className="font-bold">{t("pg.supplier.facilities")}: </span>{sourcing.facilities.join("، ")}</p>
          ) : null}
          {sourcing.cancellation_policy ? (
            <p className="mt-1 text-[#557d78]"><span className="font-bold">{t("pg.supplier.cancellation")}: </span>{sourcing.cancellation_policy}</p>
          ) : null}
          {sourcing.excluded_surcharges.length > 0 ? (
            <p className="mt-1 text-[#557d78]">
              <span className="font-bold">{t("pg.supplier.payAtHotel")}: </span>
              {sourcing.excluded_surcharges.map((s, j) => (
                <span key={j} className="tv-tnum">{j > 0 ? "، " : ""}{s.name} (<DirText dir="ltr">{`${s.amount} ${s.currency}`}</DirText>)</span>
              ))}
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px] font-semibold text-[#93aaa3]">
            {ago != null ? <span>{t("pg.supplier.updatedAgo", { min: ago })}</span> : null}
            <button type="button" onClick={onRefresh} className="inline-flex items-center gap-1 rounded-md bg-[#eef4f1] px-1.5 py-0.5 font-extrabold text-[#185045] hover:bg-[#e2ede9]">
              <RefreshCw className="size-3" />
              {t("pg.supplier.refreshRate")}
            </button>
          </div>
          {sourcing.blocked ? <p className="mt-1 font-bold text-[#c22850]">{t("pg.supplier.blocked")}</p> : null}
        </div>
      </div>
    </div>
  );
}
