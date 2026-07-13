"use client";

import { useState } from "react";
import { Loader2, RefreshCw, Search, Star } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  BOARD_LABEL_KEYS,
  BOARD_TYPES,
  deriveCityDates,
  type DraftHotel,
} from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";
import { getDraft } from "@/lib/data/drafts";
import { searchHotelsForCity, selectHotelRate, type SearchHotel, type SearchRate } from "@/lib/data/hotel-search";
import { useRole } from "@/lib/roles/RoleContext";
import type { BoardType } from "@/lib/types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass, sectionClass, type StageFormProps } from "../stage-props";

const rowLabelClass = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

function defaultLine(cityName: string): DraftHotel {
  return { city_name: cityName, hotel_id: null, hotel_name: "", room_type_id: null, room_type_name: "", board_type: null, rooms_count: 1 };
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

  const country = lookups.countries.find((c) => c.name === data.trip.country);
  const derivedCities = deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities);

  function lineFor(cityName: string): DraftHotel {
    return data.hotels.find((h) => h.city_name === cityName) ?? defaultLine(cityName);
  }

  function setHotel(cityName: string, slice: Partial<DraftHotel>) {
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
    setSearchError(null);
    setFilters({ minStars: 0, board: "", refundableOnly: false, maxPrice: "" });
    setSearching(true);
    const res = await searchHotelsForCity(draftId, cityName);
    if (res.ok) setResults(res.hotels);
    else setSearchError(t(res.error));
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
                    <button
                      type="button"
                      onClick={() => (isSearching ? setSearchCity(null) : void openSearch(city.city_name))}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439]"
                    >
                      <Search className="size-3.5" />
                      {t("pg.supplier.searchHotels")}
                    </button>
                  </div>
                </div>

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
                      <p className="py-2 text-[12.5px] text-[#93aaa3]">{t("pg.supplier.noResults")}</p>
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
                        setHotel(city.city_name, { hotel_name: name, hotel_id: match ? match.id : null });
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
                  <label className={rowLabelClass}>
                    {t("pg.roomType")}
                    <select
                      value={line.room_type_id ?? ""}
                      onChange={(e) => {
                        const roomType = lookups.roomTypes.find((rt) => rt.id === e.target.value) ?? null;
                        const slice: Partial<DraftHotel> = { room_type_id: roomType ? roomType.id : null, room_type_name: roomType ? roomType.name : "" };
                        if (line.board_type === null && roomType?.default_board) slice.board_type = roomType.default_board;
                        setHotel(city.city_name, slice);
                      }}
                      className={fieldClass}
                    >
                      <option value="">{t("pg.chooseRoomType")}</option>
                      {roomTypeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                  </label>
                  <div className="grid grid-cols-[1fr_110px] gap-3">
                    <label className={rowLabelClass}>
                      {t("pg.board")}
                      <select value={line.board_type ?? ""} onChange={(e) => setHotel(city.city_name, { board_type: e.target.value === "" ? null : (e.target.value as BoardType) })} className={fieldClass}>
                        <option value="">{t("pg.chooseBoard")}</option>
                        {BOARD_TYPES.map((board) => <option key={board} value={board}>{t(BOARD_LABEL_KEYS[board])}</option>)}
                      </select>
                    </label>
                    <label className={rowLabelClass}>
                      {t("pg.roomsCount")}
                      <input type="number" min={1} dir="ltr" value={line.rooms_count} onChange={(e) => setHotel(city.city_name, { rooms_count: Math.max(Number(e.target.value) || 1, 1) })} className={`${fieldClass} tv-tnum text-center`} />
                    </label>
                  </div>
                </div>

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
