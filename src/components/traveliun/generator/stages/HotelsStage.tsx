"use client";

import { useState } from "react";
import { Loader2, Plus, RefreshCw, Search, Star, Trash2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  BOARD_LABEL_KEYS,
  BOARD_TYPES,
  CURRENCIES,
  deriveCityDates,
  findLookupCountry,
  hotelCoverage,
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
  searchInternalHotels,
  selectHotelRate,
  type InternalHotel,
  type SearchHotel,
  type SearchRate,
  type SupplierNote,
} from "@/lib/data/hotel-search";
import { useRole } from "@/lib/roles/RoleContext";
import type { BoardType } from "@/lib/types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass, sectionClass, type StageFormProps } from "../stage-props";

const rowLabelClass = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

/**
 * Eight results first, more on request.
 *
 * A city can return a hundred hotels and an agent reads the first handful. The
 * cap is about the reading, not the fetching — everything is already priced, so
 * "عرض المزيد" costs nothing but scrolling.
 */
const PAGE = 8;

const EMPTY_FILTERS = {
  name: "",
  minStars: 0,
  board: "",
  /** all | yes | no — "غير قابل للاسترداد" is a deliberate choice, not just the absence of one. */
  refundable: "all" as "all" | "yes" | "no",
  maxPrice: "",
  sort: "price" as "price" | "price_desc" | "stars",
};

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

  /** the STAY whose search panel is open — not the city, since a city can hold two. */
  const [searchStay, setSearchStay] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchHotel[] | null>(null);
  const [internal, setInternal] = useState<InternalHotel[] | null>(null);
  const [searchNights, setSearchNights] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [shown, setShown] = useState(PAGE);
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

  /**
   * The lines we actually render: whatever the draft holds, plus a starter line
   * for any city that has none. Orphans (a city the agent deleted) fall away,
   * which is what the old rebuild-from-cities did too.
   */
  const lines: DraftHotel[] = derivedCities.flatMap((c) => {
    const mine = data.hotels.filter((h) => h.city_name === c.city_name);
    return mine.length > 0 ? mine : [defaultLine(c.city_name, data.trip)];
  });
  const coverage = hotelCoverage(derivedCities, lines);

  /**
   * Replace ONE stay's whole line — used whenever rooms[] changes, because the
   * array and its mirrors (rooms_count, room 1's type/board) must move together
   * and only withRooms() is allowed to set them.
   *
   * A supplier rate is priced for a specific room product, so changing the hotel
   * or any room voids it rather than leaving a stale price attached to something
   * the supplier never quoted.
   */
  function setLine(id: string, next: DraftHotel) {
    patch({
      hotels: lines.map((line) => {
        if (line.id !== id) return line;
        const productChanged =
          next.hotel_name !== line.hotel_name ||
          next.rooms.length !== line.rooms.length ||
          next.rooms.some(
            (r, i) => r.room_type_name !== line.rooms[i]?.room_type_name || r.board_type !== line.rooms[i]?.board_type,
          );
        return productChanged && line.sourcing ? { ...next, sourcing: null } : next;
      }),
    });
  }

  /**
   * Patch the NON-room fields of one stay. The rooms array and its mirrors are
   * excluded at the type level: writing `board_type` here would change what
   * validation reads on room 1 while rooms[0] still said something else, and the
   * two would disagree silently. Room edits go through setLine + withRooms.
   */
  function setHotel(id: string, slice: HotelScalarSlice) {
    const productChanged = "hotel_name" in slice || "hotel_id" in slice || "board_type" in slice || "rooms_count" in slice;
    patch({
      hotels: lines.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, ...slice };
        if (productChanged && line.sourcing) next.sourcing = null;
        return next;
      }),
    });
  }

  /**
   * A second hotel in the same city.
   *
   * It is inserted directly after that city's last line — order is what decides
   * the dates, so appending to the end of the whole array would give the new
   * stay another city's nights.
   */
  function addStay(cityName: string) {
    const next = [...lines];
    let at = -1;
    next.forEach((l, i) => {
      if (l.city_name === cityName) at = i;
    });
    // The city's remaining nights are the obvious suggestion; the agent adjusts.
    const cov = coverage.find((c) => c.city_name === cityName);
    const left = Math.max(0, (cov?.needed ?? 0) - (cov?.covered ?? 0));
    const fresh = { ...defaultLine(cityName, data.trip), nights: left };
    next.splice(at + 1, 0, fresh);
    patch({ hotels: next });
  }

  function removeStay(id: string) {
    patch({ hotels: lines.filter((l) => l.id !== id) });
    if (searchStay === id) setSearchStay(null);
  }

  /** Open the panel for a stay, and run the search with the current filters. */
  async function openSearch(cityName: string, stayId: string, keepFilters = false) {
    setSearchStay(stayId);
    setResults(null);
    setNotes([]);
    setSearchError(null);
    setShown(PAGE);
    const active = keepFilters ? filters : EMPTY_FILTERS;
    if (!keepFilters) setFilters(EMPTY_FILTERS);
    setSearching(true);
    // The hotel NAME goes to the supplier; everything else narrows what came
    // back. A name filtered on our side would hide hotels beyond the supplier's
    // own result cap — which is exactly the hotel someone is searching for.
    const res = await searchHotelsForCity(draftId, cityName, "tbo", stayId, { hotel_name: active.name });
    if (res.ok) {
      setResults(res.hotels);
      setNotes(res.notes);
      setSearchNights(res.nights);
    } else setSearchError(t(res.error));
    setSearching(false);
  }

  /** Our own list for this city, with what we last charged for each hotel. */
  async function openInternal(cityName: string, stayId: string, keepFilters = false) {
    setSearchStay(stayId);
    setResults(null);
    setInternal(null);
    setNotes([]);
    setSearchError(null);
    setShown(PAGE);
    const active = keepFilters ? filters : EMPTY_FILTERS;
    if (!keepFilters) setFilters(EMPTY_FILTERS);
    setSearching(true);
    const res = await searchInternalHotels(draftId, cityName, { hotel_name: active.name });
    if (res.ok) setInternal(res.hotels);
    else setSearchError(t(res.error));
    setSearching(false);
  }

  /**
   * Take an internal hotel onto the line.
   *
   * The last quoted price is carried across as the manual price — it is the
   * number the agent would have looked up anyway — but it is a STARTING POINT,
   * shown with the date it came from so nobody mistakes last winter's rate for
   * today's.
   */
  function chooseInternal(stayId: string, line: DraftHotel, hotel: InternalHotel) {
    const board = hotel.last?.board_type ?? line.board_type;
    const roomName = hotel.last?.room_type_name || line.room_type_name;
    setLine(
      stayId,
      withRooms(
        {
          ...line,
          hotel_id: hotel.id,
          hotel_name: hotel.name,
          hotel_name_en: hotel.name_en ?? line.hotel_name_en,
          manual_price: hotel.last ? hotel.last.per_night * Math.max(1, line.nights || 1) : line.manual_price,
          manual_currency: hotel.last?.currency ?? line.manual_currency,
          sourcing: null,
        },
        line.rooms.map((r) => ({ ...r, room_type_name: roomName, board_type: board })),
      ),
    );
    setSearchStay(null);
    setInternal(null);
  }

  async function choose(cityName: string, stayId: string, hotel: SearchHotel, rate: SearchRate) {
    setSelecting(rate.rate_key);
    const res = await selectHotelRate(draftId, cityName, hotel.supplier, hotel.supplier_hotel_id, rate.rate_key, stayId);
    if (res.ok) {
      const fresh = await getDraft(draftId);
      if (fresh) replace(fresh.data);
      setSearchStay(null);
      setResults(null);
    } else {
      setSearchError(t(res.error));
    }
    setSelecting(null);
  }

  function rateMatches(hotel: SearchHotel, rate: SearchRate): boolean {
    if (filters.board && rate.board_type !== filters.board) return false;
    if (filters.refundable === "yes" && !rate.refundable) return false;
    if (filters.refundable === "no" && rate.refundable) return false;
    // Compared per NIGHT, because that is the number in the box beside it.
    if (filters.maxPrice && rate.per_night > Number(filters.maxPrice)) return false;
    if (filters.minStars && (hotel.star_rating ?? 0) < filters.minStars) return false;
    return true;
  }

  /** Hotels that still have a matching rate, in the order the agent asked for. */
  function visibleHotels(): SearchHotel[] {
    const kept = (results ?? []).filter((h) => h.rates.some((r) => rateMatches(h, r)));
    const cheapest = (h: SearchHotel) =>
      Math.min(...h.rates.filter((r) => rateMatches(h, r)).map((r) => r.per_night));
    return [...kept].sort((a, b) => {
      if (filters.sort === "stars") return (b.star_rating ?? 0) - (a.star_rating ?? 0);
      return filters.sort === "price_desc" ? cheapest(b) - cheapest(a) : cheapest(a) - cheapest(b);
    });
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
          {coverage.map((cov, cityIndex) => {
            const city = derivedCities[cityIndex];
            const lookupCity = country?.cities.find((c) => c.name === cov.city_name);
            const hotelOptions = lookupCity?.hotels ?? [];
            const short = cov.covered !== cov.needed;

            return (
              <div key={cityIndex} className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-extrabold text-[#003c3a]">{cov.city_name || "—"}</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="tv-tnum text-[11.5px] font-semibold text-[#93aaa3]">
                      {city?.check_in && city?.check_out ? (
                        <DirText dir="ltr">{`${city.check_in} → ${city.check_out}`}</DirText>
                      ) : null}
                    </p>
                    {/* Coverage, not «سطر موجود». A city split between two hotels
                        with a night missing looked complete under the old rule. */}
                    <span
                      className={`tv-tnum rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                        short ? "bg-[#fff8e8] text-[#a86a10]" : "bg-[#e9f7f0] text-[#0f7a52]"
                      }`}
                    >
                      <DirText dir="ltr">{`${cov.covered}/${cov.needed}`}</DirText> ليالٍ مغطّاة
                    </span>
                    <button
                      type="button"
                      onClick={() => addStay(cov.city_name)}
                      className="inline-flex h-8 items-center gap-1 rounded-[9px] border border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
                    >
                      <Plus className="size-3.5" />
                      فندق آخر
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {cov.stays.map((stay, stayIndex) => {
                    const line = stay.line;
                    const roomTypeOptions = lookups.roomTypes.filter(
                      (rt) => rt.hotel_id === line.hotel_id || rt.hotel_id === null,
                    );
                    const isSearching = searchStay === line.id;

                    return (
                      <div key={line.id} className="rounded-[11px] border border-[#e2ebe7] bg-white p-3">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12px] font-extrabold text-[#185045]">
                              {cov.stays.length > 1 ? `الفندق ${stayIndex + 1}` : "الفندق"}
                            </span>
                            <label className="flex items-center gap-1.5 text-[11px] font-bold text-[#557d78]">
                              ليالٍ
                              <input
                                type="number"
                                min={0}
                                dir="ltr"
                                value={line.nights || stay.nights}
                                onChange={(e) => setHotel(line.id, { nights: Math.max(0, Number(e.target.value)) })}
                                className={`${fieldClass} tv-tnum h-8 w-16 text-center`}
                              />
                            </label>
                            {stay.check_in && stay.check_out ? (
                              <span className="tv-tnum text-[11px] font-semibold text-[#93aaa3]">
                                <DirText dir="ltr">{`${stay.check_in} → ${stay.check_out}`}</DirText>
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {/* The source choice. Internal = our own contracted
                                list, priced by hand; TBO = live inventory at a
                                live price. Per STAY, so a city can mix them. */}
                            <div className="inline-flex overflow-hidden rounded-[9px] border border-[#cfe0d9]">
                              {(["internal", "tbo"] as const).map((key) => {
                                const active = (source[line.id] ?? "internal") === key;
                                return (
                                  <button
                                    key={key}
                                    type="button"
                                    onClick={() => {
                                      setSource((s) => ({ ...s, [line.id]: key }));
                                      // Switching source closes the other one's
                                      // results — they price different things.
                                      if (isSearching) setSearchStay(null);
                                      setResults(null);
                                      setInternal(null);
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
                            {(source[line.id] ?? "internal") === "tbo" ? (
                              <button
                                type="button"
                                disabled={!canSearchLive}
                                title={canSearchLive ? undefined : "الدولة بلا رمز ISO — لا يمكن البحث لدى المورّد"}
                                onClick={() =>
                                  isSearching ? setSearchStay(null) : void openSearch(cov.city_name, line.id)
                                }
                                className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-50"
                              >
                                <Search className="size-3.5" />
                                {t("pg.supplier.searchHotels")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  isSearching ? setSearchStay(null) : void openInternal(cov.city_name, line.id)
                                }
                                className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439]"
                              >
                                <Search className="size-3.5" />
                                ابحث في فنادق النظام
                              </button>
                            )}
                            {cov.stays.length > 1 ? (
                              <button
                                type="button"
                                onClick={() => removeStay(line.id)}
                                aria-label={t("delete")}
                                className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#f2c7c7] text-[#c43d3d] hover:bg-[#fff1f1]"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </div>

                {/* Occupancy is NOT re-entered here: it was agreed with the
                    customer on stage 1 and the supplier is asked for exactly
                    that. Shown so the agent can see what is being priced. */}
                {(source[line.id] ?? "internal") === "tbo" ? (
                  <p className="tv-tnum mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-[#557d78]">
                    <span>
                      البحث لـ <DirText dir="ltr">{data.trip.adults}</DirText> بالغ
                      {data.trip.children > 0 ? (
                        <> و<DirText dir="ltr">{data.trip.children}</DirText> طفل</>
                      ) : null}{" "}
                      · <DirText dir="ltr">{line.rooms_count}</DirText> غرفة ·{" "}
                      <DirText dir="ltr">{stay.nights}</DirText> ليلة
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

                {/* OUR OWN list — searched by name, priced from what we last charged */}
                {isSearching && (source[line.id] ?? "internal") === "internal" ? (
                  <div className="mb-3 rounded-[10px] border border-[#d6eadf] bg-white p-3">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void openInternal(cov.city_name, line.id, true);
                      }}
                      className="mb-2 flex flex-wrap items-end gap-2"
                    >
                      <label className="grid flex-1 gap-1 text-[11.5px] font-bold text-[#185045]">
                        اسم الفندق
                        <input
                          value={filters.name}
                          onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))}
                          placeholder="اتركه فارغاً لعرض كل فنادق المدينة"
                          className={`${fieldClass} h-9`}
                        />
                      </label>
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#b7d0c7] px-3 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
                      >
                        <Search className="size-3.5" />
                        ابحث
                      </button>
                    </form>

                    {searching ? (
                      <p className="flex items-center gap-2 py-4 text-[12.5px] font-bold text-[#557d78]">
                        <Loader2 className="size-4 animate-spin" />
                        {t("pg.supplier.searching")}
                      </p>
                    ) : searchError ? (
                      <p className="py-2 text-[12.5px] font-bold text-[#c22850]">{searchError}</p>
                    ) : internal && internal.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="tv-tnum text-[11px] font-bold text-[#93aaa3]">
                          <DirText dir="ltr">{internal.length}</DirText> فندق في النظام · السعر من آخر عرض صدر لهذا
                          الفندق
                        </p>
                        {internal.slice(0, shown).map((h) => (
                          <div
                            key={h.id}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[9px] border border-[#e2ebe7] p-2 text-[11.5px]"
                          >
                            <span className="font-extrabold text-[#003c3a]">{h.name}</span>
                            {h.stars ? (
                              <span className="inline-flex items-center text-[#e0a400]">
                                {Array.from({ length: h.stars }).map((_, i) => (
                                  <Star key={i} className="size-3 fill-current" />
                                ))}
                              </span>
                            ) : null}
                            {h.last ? (
                              <>
                                <span className="tv-tnum font-extrabold text-[#0f3d38]">
                                  <DirText dir="ltr">{`${h.last.per_night} ${h.last.currency}`}</DirText>
                                  <span className="font-bold text-[#93aaa3]"> / ليلة</span>
                                </span>
                                {h.last.board_type ? (
                                  <span className="rounded-full bg-[#eef4f1] px-2 py-0.5 font-bold text-[#557d78]">
                                    {t(BOARD_LABEL_KEYS[h.last.board_type])}
                                  </span>
                                ) : null}
                                {h.last.room_type_name ? (
                                  <span className="font-bold text-[#557d78]">{h.last.room_type_name}</span>
                                ) : null}
                                {/* The age of the number matters as much as the
                                    number — last winter's rate is not today's. */}
                                {h.last.quoted_for ? (
                                  <span className="tv-tnum text-[11px] font-semibold text-[#93aaa3]">
                                    آخر عرض <DirText dir="ltr">{h.last.quoted_for}</DirText>
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span className="font-bold text-[#a86a10]">لا يوجد سعر سابق — أدخِله يدوياً</span>
                            )}
                            <button
                              type="button"
                              onClick={() => chooseInternal(line.id, line, h)}
                              className="ms-auto inline-flex h-7 items-center rounded-[8px] bg-[#185045] px-2.5 text-[11px] font-bold text-white hover:bg-[#0f4439]"
                            >
                              {t("pg.supplier.select")}
                            </button>
                          </div>
                        ))}
                        {internal.length > shown ? (
                          <button
                            type="button"
                            onClick={() => setShown((n) => n + PAGE)}
                            className="tv-tnum w-full rounded-[9px] border border-[#cfe0d9] py-2 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
                          >
                            عرض المزيد ({internal.length - shown})
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <p className="py-2 text-[12.5px] text-[#93aaa3]">
                        لا توجد فنادق مسجّلة لهذه المدينة في النظام — أضِفها من قسم البيانات، أو استخدم TBO.
                      </p>
                    )}
                  </div>
                ) : null}

                {/* supplier search panel */}
                {isSearching && (source[line.id] ?? "internal") === "tbo" ? (
                  <div className="mb-3 rounded-[10px] border border-[#d6eadf] bg-white p-3">
                    {/* The name goes back to the SUPPLIER (it filters before its
                        own result cap); everything below narrows what returned. */}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void openSearch(cov.city_name, line.id, true);
                      }}
                      className="mb-2 flex flex-wrap items-end gap-2"
                    >
                      <label className="grid flex-1 gap-1 text-[11.5px] font-bold text-[#185045]">
                        اسم الفندق
                        <input
                          value={filters.name}
                          onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))}
                          placeholder="اتركه فارغاً لعرض كل المتاح"
                          className={`${fieldClass} h-9`}
                        />
                      </label>
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#b7d0c7] px-3 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
                      >
                        <Search className="size-3.5" />
                        ابحث
                      </button>
                    </form>

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
                        الاسترداد
                        <select
                          value={filters.refundable}
                          onChange={(e) => setFilters((f) => ({ ...f, refundable: e.target.value as typeof f.refundable }))}
                          className={`${fieldClass} h-9`}
                        >
                          <option value="all">الكل</option>
                          <option value="yes">قابل للاسترداد</option>
                          <option value="no">غير قابل للاسترداد</option>
                        </select>
                      </label>
                      <label className="grid gap-1">
                        أعلى سعر لليلة
                        <input type="number" dir="ltr" value={filters.maxPrice} onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))} className={`${fieldClass} tv-tnum h-9 w-24`} />
                      </label>
                      <label className="grid gap-1">
                        الترتيب
                        <select
                          value={filters.sort}
                          onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as typeof f.sort }))}
                          className={`${fieldClass} h-9`}
                        >
                          <option value="price">الأرخص</option>
                          <option value="price_desc">الأغلى</option>
                          <option value="stars">النجوم</option>
                        </select>
                      </label>
                    </div>

                    {searching ? (
                      <p className="flex items-center gap-2 py-4 text-[12.5px] font-bold text-[#557d78]"><Loader2 className="size-4 animate-spin" />{t("pg.supplier.searching")}</p>
                    ) : searchError ? (
                      <p className="py-2 text-[12.5px] font-bold text-[#c22850]">{searchError}</p>
                    ) : results && visibleHotels().length > 0 ? (
                      <div className="space-y-2">
                        <p className="tv-tnum text-[11px] font-bold text-[#93aaa3]">
                          <DirText dir="ltr">{visibleHotels().length}</DirText> فندق متاح ·{" "}
                          <DirText dir="ltr">{searchNights}</DirText> ليلة · السعر المعروض لليلة الواحدة
                        </p>
                        {visibleHotels().slice(0, shown).map((hotel) => {
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
                                <div className="mt-1 space-y-1.5">
                                  {rates.map((rate) => (
                                    <div key={rate.rate_key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]">
                                      {/* The refund terms in words, not just a
                                          badge. "غير قابل للاسترداد" and "مجاني
                                          حتى ١٢ أغسطس" are different promises,
                                          and the client will be told one of them. */}
                                      <span className="font-bold text-[#185045]">{rate.room_name}</span>
                                      <span className="rounded-full bg-[#eef4f1] px-2 py-0.5 font-bold text-[#557d78]">{t(BOARD_LABEL_KEYS[rate.board_type])}</span>
                                      <span className={`rounded-full px-2 py-0.5 font-bold ${rate.refundable ? "bg-[#e4f6ef] text-[#10966b]" : "bg-[#fdeef2] text-[#c22850]"}`}>
                                        {rate.refundable ? t("pg.supplier.refundable") : t("pg.supplier.nonRefundable")}
                                      </span>
                                      {/* Per night first — it is what hotels are
                                          compared by; the total follows it. */}
                                      <span className="tv-tnum font-extrabold text-[#0f3d38]">
                                        <DirText dir="ltr">{`${rate.per_night} SAR`}</DirText>
                                        <span className="font-bold text-[#93aaa3]"> / ليلة</span>
                                      </span>
                                      <span className="tv-tnum font-bold text-[#557d78]">
                                        <DirText dir="ltr">{`${rate.sell} SAR`}</DirText> إجمالي
                                      </span>
                                      <button
                                        type="button"
                                        disabled={selecting !== null}
                                        onClick={() => void choose(cov.city_name, line.id, hotel, rate)}
                                        className="ms-auto inline-flex h-7 items-center gap-1 rounded-[8px] bg-[#185045] px-2.5 text-[11px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
                                      >
                                        {selecting === rate.rate_key ? <Loader2 className="size-3 animate-spin" /> : null}
                                        {t("pg.supplier.select")}
                                      </button>
                                      {rate.cancellation_policy ? (
                                        <p className="basis-full text-[11px] font-semibold text-[#93aaa3]">
                                          {rate.cancellation_policy}
                                        </p>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {visibleHotels().length > shown ? (
                          <button
                            type="button"
                            onClick={() => setShown((n) => n + PAGE)}
                            className="tv-tnum w-full rounded-[9px] border border-[#cfe0d9] py-2 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
                          >
                            عرض المزيد ({visibleHotels().length - shown})
                          </button>
                        ) : null}
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
                        setLine(line.id, withRooms({ ...line, hotel_name: name, hotel_id: hotelId }, pinned));
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
                    <input value={line.hotel_id === null ? line.hotel_name : ""} onChange={(e) => setHotel(line.id, { hotel_name: e.target.value, hotel_id: null })} className={fieldClass} />
                  </label>
                  {/* the Latin name a traveller shows a taxi driver */}
                  <label className={rowLabelClass}>
                    {t("pg.hotelNameEn")}
                    <input
                      dir="ltr"
                      value={line.hotel_name_en}
                      onChange={(e) => setHotel(line.id, { hotel_name_en: e.target.value })}
                      className={`${fieldClass} text-start`}
                      placeholder="Baku Center Hotel"
                    />
                  </label>
                  <label className={rowLabelClass}>
                    {t("pg.roomsCount")}
                    <input
                      type="number" min={1} dir="ltr"
                      value={line.rooms_count}
                      onChange={(e) => setLine(line.id, resizeRooms(line, Number(e.target.value)))}
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
                          line.id,
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
                          setHotel(line.id, {
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
                        onChange={(e) => setHotel(line.id, { manual_currency: e.target.value })}
                        className={fieldClass}
                      >
                        {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
                      </select>
                    </label>
                  </div>
                ) : null}

                {/* selected supplier rate — image, facilities, price, freshness */}
                {line.sourcing ? (
                  <SelectedHotelCard sourcing={line.sourcing} canInternal={canInternal} onRefresh={() => void openSearch(cov.city_name, line.id)} />
                ) : null}
                      </div>
                    );
                  })}
                </div>
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
