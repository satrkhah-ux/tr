"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  deriveCityDates,
  findLookupCountry,
  hotelCoverage,
  normalizeDraftHotel,
  resizeRooms,
  withRooms,
  type DraftHotel,
  type DraftTrip,
} from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";
import { getDraft } from "@/lib/data/drafts";
import {
  searchHotelsForCity,
  searchInternalHotels,
  selectHotelRate,
  type HotelOption,
  type HotelRateOption,
  type SupplierNote,
} from "@/lib/data/hotel-search";
import { useRole } from "@/lib/roles/RoleContext";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { sectionClass, type StageFormProps } from "../stage-props";
import { StayCard } from "../hotels/StayCard";
import { EMPTY_FILTERS, type PickerFilters, type PickerSource } from "../hotels/HotelPicker";

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
  const room = { room_type_id: null, room_type_name: trip.default_room_type_name, board_type: trip.default_board };
  return normalizeDraftHotel({
    city_name: cityName,
    rooms: Array.from({ length: Math.max(trip.rooms || 1, 1) }, () => ({ ...room })),
    rooms_count: Math.max(trip.rooms || 1, 1),
  });
}

/**
 * Stage 4 — the nights of every city, covered by one or more stays.
 *
 * This component owns the CITIES, the coverage arithmetic and the search state;
 * a single stay renders itself through StayCard, which shows either what was
 * chosen or the picker — never both. That split is the fix for the screen an
 * agent described as scattered: three live forms per stay, none of them saying
 * which one held the price.
 */
export function HotelsStage({ draftId, data, patch, replace, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const canInternal = can("pricing.internal");

  /** the stay whose picker is open — one at a time, deliberately. */
  const [choosing, setChoosing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<HotelOption[] | null>(null);
  const [notes, setNotes] = useState<SupplierNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [filters, setFilters] = useState<PickerFilters>(EMPTY_FILTERS);
  /**
   * The source per stay, and the one to use for the NEXT stay.
   *
   * Remembering it is the «الاعتماد على الإدخال السابق» the agent asked for: a
   * four-city trip is four identical choices otherwise.
   */
  const [source, setSource] = useState<Record<string, string>>({});
  const [lastSource, setLastSource] = useState("internal");

  const country = findLookupCountry(lookups.countries, data.trip.country);
  const derivedCities = deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities);

  /** Lines to render: the draft's, plus a starter for any city that has none. */
  const lines: DraftHotel[] = derivedCities.flatMap((c) => {
    const mine = data.hotels.filter((h) => h.city_name === c.city_name);
    return mine.length > 0 ? mine : [defaultLine(c.city_name, data.trip)];
  });
  const coverage = hotelCoverage(derivedCities, lines);

  /**
   * The sources, named once.
   *
   * TBO appears even when it cannot be searched, with the reason — a tab that
   * disappears reads as a broken screen, and the agent then asks why the system
   * "lost" the supplier.
   */
  const sources: PickerSource[] = [
    { code: "internal", label: "النظام الداخلي", enabled: true },
    // Every connected supplier, straight from what is enabled — a new one
    // appears here on its own, and none of them is written into this screen.
    ...lookups.hotelSources.map((s) => ({
      code: s.code,
      label: s.name,
      demo: s.demo,
      // A live supplier resolves the city inside a country; the demo engine
      // invents its own, so it works without one.
      enabled: s.demo || Boolean(country?.iso2),
      reason:
        s.demo || country?.iso2 ? undefined : `الدولة «${data.trip.country}» بلا رمز ISO في قسم الدول`,
    })),
    { code: "manual", label: "يدوي", enabled: true },
  ];
  const sourceLabel = (code: string) => sources.find((s) => s.code === code)?.label ?? code;

  function sourceFor(line: DraftHotel): string {
    if (source[line.id]) return source[line.id];
    // A line already priced from a supplier says where it came from.
    if (line.sourcing) return line.sourcing.supplier_id;
    return lastSource;
  }

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
   * A second hotel in the same city, inserted after that city's last line —
   * order decides the dates, so appending to the end of the array would hand
   * the new stay another city's nights.
   */
  function addStay(cityName: string) {
    const next = [...lines];
    let at = -1;
    next.forEach((l, i) => {
      if (l.city_name === cityName) at = i;
    });
    const cov = coverage.find((c) => c.city_name === cityName);
    const left = Math.max(0, (cov?.needed ?? 0) - (cov?.covered ?? 0));
    const fresh = { ...defaultLine(cityName, data.trip), nights: left };
    next.splice(at + 1, 0, fresh);
    patch({ hotels: next });
    setChoosing(fresh.id);
    resetPicker();
  }

  function removeStay(id: string) {
    patch({ hotels: lines.filter((l) => l.id !== id) });
    if (choosing === id) setChoosing(null);
  }

  function resetPicker() {
    setResults(null);
    setNotes([]);
    setError(null);
    setFilters(EMPTY_FILTERS);
  }

  async function runSearch(cityName: string, line: DraftHotel) {
    const code = sourceFor(line);
    if (code === "manual") return;
    setSearching(true);
    setError(null);
    setResults(null);
    setNotes([]);
    if (code === "internal") {
      const res = await searchInternalHotels(draftId, cityName, line.id, { hotel_name: filters.name });
      if (res.ok) setResults(res.hotels);
      else setError(t(res.error));
    } else {
      const res = await searchHotelsForCity(draftId, cityName, code, line.id, { hotel_name: filters.name });
      if (res.ok) {
        setResults(res.hotels);
        setNotes(res.notes);
      } else setError(t(res.error));
    }
    setSearching(false);
  }

  /**
   * Take a result onto the line.
   *
   * A supplier rate goes through selectHotelRate, which re-fetches it live and
   * refuses an expired one; an internal hotel is written here, carrying its last
   * quoted price as a STARTING POINT the agent can change.
   */
  async function select(cityName: string, line: DraftHotel, hotel: HotelOption, rate: HotelRateOption | null) {
    if (hotel.source === "internal") {
      setLine(
        line.id,
        withRooms(
          {
            ...line,
            hotel_id: hotel.id,
            hotel_name: hotel.name,
            hotel_name_en: hotel.name_en ?? line.hotel_name_en,
            manual_price: rate ? Math.round(rate.total) : line.manual_price,
            manual_currency: rate?.currency ?? line.manual_currency,
            sourcing: null,
          },
          line.rooms.map((r) => ({
            ...r,
            room_type_name: rate?.room && rate.room !== "—" ? rate.room : r.room_type_name,
            board_type: rate?.board ?? r.board_type,
          })),
        ),
      );
      setChoosing(null);
      resetPicker();
      return;
    }

    if (!rate) return;
    setBusyKey(rate.key);
    const res = await selectHotelRate(draftId, cityName, hotel.source, hotel.id, rate.key, line.id);
    if (res.ok) {
      const fresh = await getDraft(draftId);
      if (fresh) replace(fresh.data);
      setChoosing(null);
      resetPicker();
    } else {
      setError(t(res.error));
    }
    setBusyKey(null);
  }

  /**
   * The party, edited from the search bar.
   *
   * Adults and children belong to the TRIP — correcting them in front of a price
   * should correct them everywhere, not just for this one search, or the package
   * ends up quoted for a different family than it is written for. Rooms belong
   * to this hotel line, so it goes through resizeRooms with everything else.
   */
  function setGuests(line: DraftHotel, g: { adults: number; children: number; rooms: number }) {
    if (g.adults !== data.trip.adults || g.children !== data.trip.children) {
      patch({ trip: { ...data.trip, adults: g.adults, children: g.children } });
    }
    if (g.rooms !== line.rooms_count) setLine(line.id, resizeRooms(line, g.rooms));
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
                    {city?.check_in && city?.check_out ? (
                      <span className="tv-tnum text-[11.5px] font-semibold text-[#93aaa3]">
                        <DirText dir="ltr">{`${city.check_in} → ${city.check_out}`}</DirText>
                      </span>
                    ) : null}
                    {/* Coverage, not «a row exists»: a city split between two
                        hotels with a night missing used to read as complete. */}
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
                    const isChoosing = choosing === line.id || !line.hotel_name.trim();

                    return (
                      <StayCard
                        key={line.id}
                        line={line}
                        index={stayIndex}
                        count={cov.stays.length}
                        nights={stay.nights}
                        checkIn={stay.check_in}
                        checkOut={stay.check_out}
                        choosing={isChoosing}
                        onChoosing={(open) => {
                          setChoosing(open ? line.id : null);
                          resetPicker();
                        }}
                        editing={editing === line.id}
                        onEditing={(open) => setEditing(open ? line.id : null)}
                        sourceLabel={sourceLabel(sourceFor(line))}
                        hotelOptions={hotelOptions}
                        roomTypeOptions={roomTypeOptions}
                        canInternal={canInternal}
                        picker={{
                          stay: {
                            cityName: cov.city_name,
                            checkIn: stay.check_in,
                            checkOut: stay.check_out,
                            nights: stay.nights,
                            guests: {
                              adults: data.trip.adults,
                              children: data.trip.children,
                              rooms: line.rooms_count,
                            },
                            // Moving the check-out IS changing how many nights
                            // this hotel covers — one truth, not a private copy.
                            onNights: (n) => setHotel(line.id, { nights: n }),
                            onGuests: (g) => setGuests(line, g),
                            hotelNames: hotelOptions.map((h) => h.name),
                          },
                          sources,
                          source: sourceFor(line),
                          onSource: (code) => {
                            setSource((s) => ({ ...s, [line.id]: code }));
                            setLastSource(code);
                            resetPicker();
                          },
                          filters,
                          onFilters: setFilters,
                          onSearch: () => void runSearch(cov.city_name, line),
                          searching: searching && choosing === line.id,
                          error: choosing === line.id || isChoosing ? error : null,
                          results: isChoosing ? results : null,
                          notes,
                          busyKey,
                          onSelect: (hotel, rate) => void select(cov.city_name, line, hotel, rate),
                        }}
                        onSetLine={(next) => setLine(line.id, next)}
                        onSetHotel={(slice) => setHotel(line.id, slice)}
                        onRemove={() => removeStay(line.id)}
                        onRefresh={() => {
                          setChoosing(line.id);
                          resetPicker();
                        }}
                      />
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
