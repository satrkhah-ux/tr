"use client";

import { useEffect, useState } from "react";
import { Copy, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { copyProgramIntoDraft, findReusablePrograms, getDraft } from "@/lib/data/drafts";
import {
  deriveCityDates,
  findLookupCountry,
  hotelCoverage,
  normalizeDraftHotel,
  resizeRooms,
  totalCityNights,
  withRooms,
  type DraftCity,
  type DraftHotel,
  type DraftTrip,
  type ReusableProgram,
} from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";
import {
  searchHotelsForCity,
  searchInternalHotels,
  selectHotelRate,
  type HotelOption,
  type HotelRateOption,
  type SupplierNote,
} from "@/lib/data/hotel-search";
import { useRole } from "@/lib/roles/RoleContext";
import { NightsIndicator } from "../NightsIndicator";
import { FieldIssue } from "../FieldIssue";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { addButtonClass, fieldClass, sectionClass, type StageFormProps } from "../stage-props";
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
 * «المدن والفنادق» — one card per city, holding that city's stays.
 *
 * These used to be two screens. The agent typed a grid of city rows, walked to
 * another route, and was shown a different arrangement of the same trip with no
 * visible relationship to what they had just written — and a night moved on one
 * screen silently changed what the other claimed. Now the city, its nights and
 * the hotels covering them are one card: choose the city, its hotel line
 * appears already carrying the rooms and meals from the customer card, and a
 * second hotel for the same city is another card inside the same block.
 *
 * It also hosts the "start from a previous programme" panel (same country, same
 * day count, exact traveler matches ranked first).
 */
export function CitiesStage({ draftId, data, patch, replace, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const canInternal = can("pricing.internal");

  const [programs, setPrograms] = useState<ReusableProgram[] | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
  const cityOptions = country?.cities ?? [];
  const used = totalCityNights(data.cities);
  const showHotels = data.scope.hotels;
  const start = itineraryStartDate(data.trip, data.flights);
  const derivedCities = deriveCityDates(start, data.cities);

  /** Lines to render: the draft's, plus a starter for any city that has none. */
  const lines: DraftHotel[] = derivedCities.flatMap((c) => {
    const mine = data.hotels.filter((h) => h.city_name === c.city_name);
    return mine.length > 0 ? mine : [defaultLine(c.city_name, data.trip)];
  });
  const coverage = hotelCoverage(derivedCities, lines);

  // reuse eligibility is DERIVED (no synchronous setState); the async load only
  // runs when eligible, and stale results are ignored via the `active` flag.
  const reuseEligible = Boolean(data.trip.country && data.trip.days > 0);
  useEffect(() => {
    if (!reuseEligible) return;
    let active = true;
    findReusablePrograms(draftId).then((result) => {
      if (active) setPrograms(result);
    });
    return () => {
      active = false;
    };
  }, [draftId, reuseEligible]);

  // ---------- cities ----------

  function setCities(next: DraftCity[]) {
    // check-in chain starts at the itinerary start (outbound flight's local
    // landing date, or the trip arrival when no flight is set yet).
    patch({ cities: deriveCityDates(start, next) });
  }

  /**
   * Renaming a city renames its hotels in the SAME patch.
   *
   * `hotels` is keyed by the city NAME, so changing the select on its own used
   * to orphan every stay in that city: it vanished from the screen and its
   * pricing item became a phantom the producer quietly reconciled away.
   */
  function setCityName(index: number, name: string) {
    const previous = data.cities[index]?.city_name ?? "";
    patch({
      cities: deriveCityDates(
        start,
        data.cities.map((c, i) => (i === index ? { ...c, city_name: name } : c)),
      ),
      hotels: data.hotels.map((h) => (h.city_name === previous ? { ...h, city_name: name } : h)),
    });
  }

  /**
   * A new city, with its hotel line already in the draft.
   *
   * Persisting the line here is what makes the badge on this card and the
   * blocking validation agree: the starter line used to be synthesized at
   * render and never saved, so the screen showed a green «٣/٣ ليالٍ مغطّاة»
   * while production was blocked for a city that had no hotel at all.
   *
   * `nights: 0` means "whatever this city has left" to deriveHotelStays, so
   * re-timing the trip can never leave a stale number behind.
   */
  function addCity() {
    const name = cityOptions[0]?.name ?? "";
    const left = Math.max(0, data.trip.nights - used);
    patch({
      cities: deriveCityDates(start, [
        ...data.cities,
        { city_name: name, nights: left > 0 ? left : 1, check_in: null, check_out: null },
      ]),
      hotels: [...data.hotels, { ...defaultLine(name, data.trip), nights: 0 }],
    });
  }

  function removeCity(index: number) {
    const name = data.cities[index]?.city_name ?? "";
    const next = data.cities.filter((_, i) => i !== index);
    patch({
      cities: deriveCityDates(start, next),
      // A repeated city name keeps its stays — they belong to the stop that is
      // still in the programme.
      hotels: next.some((c) => c.city_name === name)
        ? data.hotels
        : data.hotels.filter((h) => h.city_name !== name),
    });
  }

  // ---------- stays ----------

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
          // An internal rate is a REFERENCE price, not a contract, so it fills
          // a blank and never overwrites the agent's own answer. (A supplier
          // rate is the opposite and still wins, through selectHotelRate: you
          // are buying that exact product and cannot promise half board on a
          // bed-and-breakfast rate.)
          line.rooms.map((r) => ({
            ...r,
            room_type_name: r.room_type_name || (rate?.room && rate.room !== "—" ? rate.room : ""),
            board_type: r.board_type ?? rate?.board ?? null,
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

  async function copyProgram(serial: string) {
    setCopying(serial);
    const result = await copyProgramIntoDraft(draftId, serial);
    if (result.ok) {
      const fresh = await getDraft(draftId);
      if (fresh) {
        replace(fresh.data);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    }
    setCopying(null);
  }

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
      reason: s.demo || country?.iso2 ? undefined : `الدولة «${data.trip.country}» بلا رمز ISO في قسم الدول`,
    })),
    { code: "manual", label: "يدوي", enabled: true },
  ];
  const sourceLabel = (code: string) => sources.find((s) => s.code === code)?.label ?? code;

  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-[#003c3a]">{t("pg.citiesTitle")}</h2>
          <p className="text-[11.5px] font-semibold text-[#93aaa3]">{t("pg.datesAuto")}</p>
        </div>
        <FieldIssue field="cities" className="mb-3" />
        <FieldIssue field="hotels" className="mb-3" />

        {data.cities.length === 0 ? (
          <p className="mb-4 rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#93aaa3]">
            {t("pg.err.noCities")}
          </p>
        ) : (
          <div className="mb-4 space-y-3">
            {data.cities.map((city, cityIndex) => {
              const derived = derivedCities[cityIndex];
              const cov = coverage.find((c) => c.city_name === city.city_name);
              const lookupCity = country?.cities.find((c) => c.name === city.city_name);
              const hotelOptions = lookupCity?.hotels ?? [];
              const short = cov ? cov.covered !== cov.needed : false;

              return (
                <div key={cityIndex} className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
                  {/* The city, its nights and its dates — the facts the stays
                      below are measured against, so they sit above them. */}
                  <div className="grid items-end gap-3 md:grid-cols-[1fr_100px_1fr_auto]">
                    <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                      {t("pg.city")}
                      <select
                        value={city.city_name}
                        onChange={(e) => setCityName(cityIndex, e.target.value)}
                        className={fieldClass}
                      >
                        <option value="">{t("pg.chooseCity")}</option>
                        {cityOptions.map((option) => (
                          <option key={option.id} value={option.name}>{option.name}</option>
                        ))}
                        {city.city_name && !cityOptions.some((o) => o.name === city.city_name) ? (
                          <option value={city.city_name}>{city.city_name}</option>
                        ) : null}
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                      {t("pg.cityNights")}
                      <input
                        type="number"
                        min={0}
                        dir="ltr"
                        value={city.nights}
                        onChange={(e) =>
                          setCities(
                            data.cities.map((c, i) =>
                              i === cityIndex ? { ...c, nights: Math.max(Number(e.target.value) || 0, 0) } : c,
                            ),
                          )
                        }
                        className={`${fieldClass} tv-tnum text-center`}
                      />
                    </label>
                    <div className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                      {`${t("pg.checkIn")} → ${t("pg.checkOut")}`}
                      <p className="tv-tnum flex h-11 items-center rounded-[10px] bg-[#eef4f1] px-3 text-sm text-[#557d78]">
                        {derived?.check_in && derived?.check_out ? (
                          <DirText dir="ltr">{`${derived.check_in} → ${derived.check_out}`}</DirText>
                        ) : (
                          "—"
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCity(cityIndex)}
                      className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-[#f0d3d3] px-3 text-[11.5px] font-bold text-[#c43d3d] transition-colors hover:bg-[#fdf3f3]"
                    >
                      <Trash2 className="size-3.5" />
                      {t("pg.removeRow")}
                    </button>
                  </div>

                  {showHotels && cov ? (
                    <div className="mt-3 border-t border-[#e7f0ec] pt-3">
                      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                        {/* Coverage, not «a row exists»: a city split between
                            two hotels with a night missing used to read as
                            complete. */}
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
                                  // Moving the check-out IS changing how many
                                  // nights this hotel covers — one truth, not
                                  // a private copy.
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
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <button type="button" onClick={addCity} className={addButtonClass}>
          <Plus className="size-4" />
          {t("pg.addCity")}
        </button>

        {/* the running total sits right under the numbers being typed */}
        <div className="mt-4">
          <NightsIndicator used={used} total={data.trip.nights} match={used === data.trip.nights && data.trip.nights > 0} />
        </div>
      </section>

      {/*
        Reuse a previous programme — offered only on an EMPTY one.
        copyProgramIntoDraft replaces the cities, the hotels and the services
        wholesale, so a copy button sitting under a half-built itinerary is an
        overwrite waiting to happen.
      */}
      {data.cities.length === 0 ? (
        <section className={sectionClass}>
          <h3 className="mb-1 flex items-center gap-2 text-sm font-extrabold text-[#185045]">
            <Sparkles className="size-4 text-[#2aa87a]" />
            {t("pg.reuseTitle")}
          </h3>
          <p className="mb-3 text-[12px] font-semibold text-[#93aaa3]">{t("pg.reuseHint")}</p>
          {copied ? (
            <p className="mb-3 rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-4 py-2.5 text-[12.5px] font-bold text-[#0f7a52]">
              {t("pg.reuseCopied")}
            </p>
          ) : null}
          {!reuseEligible ? (
            <p className="text-[12.5px] text-[#93aaa3]">{t("pg.reuseNoMatches")}</p>
          ) : programs === null ? (
            <div className="tv-shimmer h-16 rounded-[10px]" />
          ) : programs.length === 0 ? (
            <p className="text-[12.5px] text-[#93aaa3]">{t("pg.reuseNoMatches")}</p>
          ) : (
            <ul className="space-y-2">
              {programs.map((program) => (
                <li
                  key={program.serial}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[11px] border border-[#e2ebe7] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="tv-tnum text-[12.5px] font-extrabold text-[#185045]">
                      <DirText dir="ltr">{program.serial}</DirText>
                      {program.samePeople ? (
                        <span className="ms-2 rounded-full bg-[#e4f6ef] px-2 py-0.5 text-[10px] font-bold text-[#10966b]">
                          {t("pg.reuseMatchPeople")}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-[#557d78]">
                      {program.cities.join(" · ") || program.destination || "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={copying !== null}
                    onClick={() => void copyProgram(program.serial)}
                    className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white transition-colors hover:bg-[#0f4439] disabled:opacity-60"
                  >
                    {copying === program.serial ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                    {t("pg.reuseCopy")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
