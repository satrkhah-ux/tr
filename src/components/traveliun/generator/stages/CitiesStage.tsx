"use client";

import { useEffect, useState } from "react";
import { BedDouble, Check, CheckCircle2, Copy, Loader2, Plane, Plus, Sparkles, Trash2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { copyProgramIntoDraft, findReusablePrograms, getDraft } from "@/lib/data/drafts";
import { createCityForCountry } from "@/lib/data/catalog-actions";
import {
  deriveCityDates,
  findLookupCountry,
  hotelCoverage,
  normalizeDraftHotel,
  resizeRooms,
  stayTotal,
  totalCityNights,
  withRooms,
  type DraftCity,
  type DraftHotel,
  type DraftTrip,
  type ReusableProgram,
} from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";
import { citiesFromFlights, citiesMatchFlights } from "@/lib/offer/flight-cities";
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
/** The select value that means «add a city that is not in the list». */
const NEW_CITY = "__new_city__";

export function CitiesStage({ draftId, data, patch, replace, flush, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const canInternal = can("pricing.internal");

  const [programs, setPrograms] = useState<ReusableProgram[] | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /** the stay whose picker is open — one at a time, deliberately. */
  // Which city has its hotels popup open. Hotels moved OUT of the inline
  // card into a modal, so the agent enters cities first and only then opens
  // one city at a time to pick its hotels.
  const [hotelsFor, setHotelsFor] = useState<number | null>(null);
  // A city typed in because the country has none (30 of 57 came over empty).
  const [newCityFor, setNewCityFor] = useState<number | null>(null);
  const [newCityName, setNewCityName] = useState("");
  const [cityBusy, setCityBusy] = useState(false);
  const [cityError, setCityError] = useState<string | null>(null);
  /** cities added during this session — offered in every row until a reload brings them from the catalogue. */
  const [extraCities, setExtraCities] = useState<string[]>([]);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** The city reopened by hand with «تعديل»; null = the first one not finished. */
  const [expanded, setExpanded] = useState<number | null>(null);
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
  const cityNames = [
    ...cityOptions.map((o) => o.name),
    ...extraCities.filter((n) => !cityOptions.some((o) => o.name === n)),
  ];
  // With no city in the list at all, the first unnamed row opens straight onto
  // «add a city» — a dropdown with nothing in it is a dead end.
  const newCityRow = newCityFor ?? (cityNames.length === 0 ? data.cities.findIndex((c) => !c.city_name.trim()) : -1);
  const used = totalCityNights(data.cities);
  const showHotels = data.scope.hotels;
  const start = itineraryStartDate(data.trip, data.flights);
  const derivedCities = deriveCityDates(start, data.cities);

  /** Lines to render: the draft's, plus a starter for any city that has none. */
  const lines: DraftHotel[] = derivedCities.flatMap((c) => {
    // An unnamed city owns no hotels. Without this, every city still on «اختر
    // مدينة» shares the same empty name, so each one claimed ALL the empty-named
    // hotels and rendered them again — the runaway duplication the agent saw.
    if (!c.city_name.trim()) return [];
    const mine = data.hotels.filter((h) => h.city_name === c.city_name);
    return mine.length > 0 ? mine : [defaultLine(c.city_name, data.trip)];
  });
  const coverage = hotelCoverage(derivedCities, lines);

  /**
   * One stay card open at a time, in programme order.
   *
   * Every line without a hotel name used to render its own picker, so a
   * four-night two-hotel trip opened three search panels at once and the agent
   * had no idea which one they were answering. The card being worked on is the
   * one explicitly opened, or else the first stay still missing a hotel.
   */
  const orderedLines = coverage.flatMap((cov) => cov.stays.map((stay) => stay.line));
  const firstUnnamed = orderedLines.find((l) => !l.hotel_name.trim())?.id ?? null;
  const openLine = choosing ?? firstUnnamed;

  /** Finished here — hand the screen to the next stay that still needs one. */
  function handOver(lineId: string) {
    const at = orderedLines.findIndex((l) => l.id === lineId);
    const next = orderedLines.slice(at + 1).find((l) => !l.hotel_name.trim());
    setChoosing(next ? next.id : null);
    setEditing(null);
    resetPicker();
  }

  /**
   * A city is finished when it has a name and nights and — when hotels are part
   * of the sale — its nights are covered by stays that each name a hotel, a room
   * and a board, and carry a price.
   */
  function cityDone(index: number): boolean {
    const city = data.cities[index];
    if (!city?.city_name.trim() || city.nights <= 0) return false;
    if (!showHotels || data.cities.findIndex((c) => c.city_name === city.city_name) !== index) return true;
    const cov = coverage.find((c) => c.city_name === city.city_name);
    return Boolean(
      cov &&
        cov.covered === cov.needed &&
        cov.stays.every(
          ({ line }) =>
            line.hotel_name.trim() &&
            line.rooms.every((room) => room.room_type_name.trim() && room.board_type) &&
            (line.sourcing || stayTotal(line) != null),
        ),
    );
  }

  /**
   * ONE city open at a time. A finished city folds into a single line — its
   * name, nights, hotels and price — and the next unfinished one opens below
   * it, so a four-city trip is never four forms on screen at once.
   */
  const firstOpen = data.cities.findIndex((_, i) => !cityDone(i));
  const openCity = expanded ?? (firstOpen >= 0 ? firstOpen : -1);

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
    // landing date, or the trip arrival when no flight is set yet). A hand edit
    // makes the cities the agent's: the flights stop rewriting them.
    patch({ cities: deriveCityDates(start, next.map((c) => ({ ...c, from_flight: false }))) });
  }

  /** What the flights say the cities are — offered when the card holds something else. */
  const fromFlights = citiesFromFlights(data.flights);
  const differsFromFlights = Boolean(fromFlights && data.cities.length > 0 && !citiesMatchFlights(data.cities, fromFlights));
  function takeCitiesFromFlights() {
    if (!fromFlights) return;
    const nights = fromFlights.reduce((sum, c) => sum + c.nights, 0);
    patch({
      cities: deriveCityDates(start, fromFlights),
      trip: { ...data.trip, nights, days: nights + 1 },
    });
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
    const hotels = data.hotels.map((h) => (h.city_name === previous ? { ...h, city_name: name } : h));
    patch({
      cities: deriveCityDates(
        start,
        data.cities.map((c, i) => (i === index ? { ...c, city_name: name } : c)),
      ),
      // A city that had no stay yet (it was still unnamed) gets its starter
      // line in the same patch — addCity's rule, so the popup and the
      // validation count the same stays.
      hotels:
        name && !hotels.some((h) => h.city_name === name)
          ? [...hotels, { ...defaultLine(name, data.trip), nights: 0 }]
          : hotels,
    });
  }

  function openNewCity(index: number) {
    setNewCityFor(index);
    setNewCityName("");
    setCityError(null);
  }

  /** Into the country's catalogue, then onto this row — and offered in every package after. */
  async function saveNewCity(index: number) {
    const name = newCityName.trim();
    if (!name || cityBusy) return;
    setCityBusy(true);
    setCityError(null);
    let res = await createCityForCountry(data.trip.country, name);
    // A near-identical city already exists: the agent decides, natively and in
    // one tap, whether they meant it — the list must not grow a second spelling.
    if (!res.ok && res.error === "pg.err.didYouMean") {
      const suggestion = res.suggestion;
      res = window.confirm(t("pg.err.didYouMean", { name: suggestion, typed: name }))
        ? { ok: true, name: suggestion, created: false }
        : await createCityForCountry(data.trip.country, name, true);
    }
    setCityBusy(false);
    if (!res.ok) {
      setCityError(t(res.error));
      return;
    }
    setExtraCities((prev) => (prev.includes(res.name) ? prev : [...prev, res.name]));
    setCityName(index, res.name);
    setNewCityFor(null);
    setNewCityName("");
  }

  /**
   * «حفظ الفندق»: make sure the edits reached the server, then hand the popup
   * to the next city still without a hotel — the agent asked to move city by
   * city, not to hunt for the next one. Every field already patched as it
   * changed; the flush only drains the debounce before we move.
   */
  async function saveHotels() {
    const from = hotelsFor ?? -1;
    await flush();
    setChoosing(null);
    resetPicker();
    const next = data.cities.findIndex((c, i) => {
      if (i <= from || !c.city_name.trim()) return false;
      if (data.cities.findIndex((x) => x.city_name === c.city_name) !== i) return false;
      const cv = coverage.find((x) => x.city_name === c.city_name);
      return !cv || cv.stays.some((s) => !s.line.hotel_name.trim());
    });
    setHotelsFor(next >= 0 ? next : null);
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
    // The first city NOT already in the programme. Defaulting to the first in
    // the list meant two presses produced two cities with the same name — and
    // because hotels are keyed by city NAME, both cities then claimed the same
    // stays, rendered them twice and double-counted their nights.
    const taken = new Set(data.cities.map((c) => c.city_name).filter(Boolean));
    // All taken (or none at all) -> an unnamed row the agent fills or adds to.
    const name = cityNames.find((n) => !taken.has(n)) ?? "";
    const left = Math.max(0, data.trip.nights - used);
    patch({
      cities: deriveCityDates(start, [
        ...data.cities,
        { city_name: name, nights: left > 0 ? left : 1, check_in: null, check_out: null },
      ]),
      // Only a NAMED city gets a starter hotel line — an unnamed one would share
      // the empty name with every other unnamed city and multiply.
      hotels: name ? [...data.hotels, { ...defaultLine(name, data.trip), nights: 0 }] : data.hotels,
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
      handOver(line.id);
      return;
    }

    if (!rate) return;
    setBusyKey(rate.key);
    const res = await selectHotelRate(draftId, cityName, hotel.source, hotel.id, rate.key, line.id);
    if (res.ok) {
      const fresh = await getDraft(draftId);
      if (fresh) replace(fresh.data);
      handOver(line.id);
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
        {differsFromFlights && fromFlights ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[11px] border border-[#cfe0d9] bg-[#f2f8f5] px-3.5 py-2.5">
            <Plane className="size-4 text-[#185045]" />
            <span className="min-w-0 flex-1 text-[12px] font-bold text-[#185045]">
              {t("pg.citiesFromFlightsOffer", {
                cities: fromFlights.map((c) => `${c.city_name} ${c.nights}`).join(" · "),
              })}
            </span>
            <button
              type="button"
              onClick={takeCitiesFromFlights}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439]"
            >
              {t("pg.citiesFromFlightsTake")}
            </button>
          </div>
        ) : null}

        {data.cities.length === 0 ? (
          <p className="mb-4 rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#93aaa3]">
            {t("pg.err.noCities")}
          </p>
        ) : (
          <div className="mb-4 space-y-3">
            {data.cities.map((city, cityIndex) => {
              const derived = derivedCities[cityIndex];
              const cov = coverage.find((c) => c.city_name === city.city_name);
              // A city name can still repeat — an agent may type one by hand,
              // and an older draft may already hold one. Each stay belongs to
              // the FIRST city of that name; the later one shows none rather
              // than a duplicate of someone else's hotel.
              const firstOfName = data.cities.findIndex((c) => c.city_name === city.city_name);
              const ownsStays = firstOfName === cityIndex;
              const lookupCity = country?.cities.find((c) => c.name === city.city_name);
              const hotelOptions = lookupCity?.hotels ?? [];
              const short = cov ? cov.covered !== cov.needed : false;
              const done = cityDone(cityIndex);

              if (cityIndex !== openCity) {
                const price = cov?.stays.reduce((sum, { line }) => sum + (stayTotal(line) ?? 0), 0) ?? 0;
                return (
                  <button
                    key={cityIndex}
                    type="button"
                    onClick={() => setExpanded(cityIndex)}
                    className="flex w-full flex-wrap items-center gap-2.5 rounded-[12px] border border-[#e2ebe7] bg-white px-3.5 py-2.5 text-start transition-colors hover:bg-[#f8fbfa]"
                  >
                    {done ? (
                      <CheckCircle2 className="size-4 shrink-0 text-[#2aa87a]" />
                    ) : (
                      <span className="size-2.5 shrink-0 rounded-full bg-[#e0a92a]" />
                    )}
                    <span className="text-[13px] font-extrabold text-[#185045]">{city.city_name || t("pg.chooseCity")}</span>
                    {city.from_flight ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#eef4f1] px-2 py-0.5 text-[10.5px] font-bold text-[#557d78]">
                        <Plane className="size-3" />
                        {t("pg.cityFromFlight")}
                      </span>
                    ) : null}
                    <span className="tv-tnum rounded-full bg-[#f2f7f5] px-2.5 py-1 text-[11.5px] font-bold text-[#557d78]">
                      <DirText dir="ltr">{String(city.nights)}</DirText> {t("pg.nightsShort")}
                    </span>
                    {showHotels && cov ? (
                      <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-[#557d78]">
                        {cov.stays.map((st) => st.line.hotel_name).filter((n) => n.trim()).join(" · ") || t("pg.cityNoHotelYet")}
                      </span>
                    ) : (
                      <span className="flex-1" />
                    )}
                    {showHotels && price > 0 ? (
                      <span className="tv-tnum text-[11.5px] font-extrabold text-[#185045]">
                        <DirText dir="ltr">{new Intl.NumberFormat("en-US").format(price)}</DirText>
                      </span>
                    ) : null}
                    <span className="shrink-0 text-[11.5px] font-bold text-[#93aaa3]">{t("pg.flow.edit")}</span>
                  </button>
                );
              }

              return (
                <div key={cityIndex} className="rounded-[12px] border border-[#cfe0d9] bg-[#f8fbf9] p-3">
                  {/* The city, its nights and its dates — the facts the stays
                      below are measured against, so they sit above them. */}
                  <div className="grid items-end gap-3 md:grid-cols-[1fr_100px_1fr_auto]">
                    <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                      {t("pg.city")}
                      <select
                        value={city.city_name}
                        onChange={(e) => {
                          if (e.target.value === NEW_CITY) {
                            openNewCity(cityIndex);
                            return;
                          }
                          setCityName(cityIndex, e.target.value);
                        }}
                        className={fieldClass}
                      >
                        <option value="">{t("pg.chooseCity")}</option>
                        {cityNames.map((name, i) => (
                          <option key={`${i}-${name}`} value={name}>{name}</option>
                        ))}
                        {city.city_name && !cityNames.includes(city.city_name) ? (
                          <option value={city.city_name}>{city.city_name}</option>
                        ) : null}
                        <option value={NEW_CITY}>{t("pg.addNewCity")}</option>
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

                  {newCityRow === cityIndex ? (
                    <div className="mt-3 rounded-[10px] border border-dashed border-[#b7d0c7] bg-white p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={newCityName}
                          onChange={(e) => setNewCityName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void saveNewCity(cityIndex);
                            }
                          }}
                          placeholder={t("pg.newCityPlaceholder")}
                          className={`${fieldClass} min-w-0 flex-1`}
                        />
                        <button
                          type="button"
                          disabled={cityBusy || !newCityName.trim()}
                          onClick={() => void saveNewCity(cityIndex)}
                          className="inline-flex h-11 items-center gap-1.5 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white transition-colors hover:bg-[#0f4439] disabled:opacity-50"
                        >
                          {cityBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                          {t("pg.saveCity")}
                        </button>
                        {newCityFor === cityIndex ? (
                          <button
                            type="button"
                            onClick={() => setNewCityFor(null)}
                            className="h-11 rounded-[10px] px-3 text-[12px] font-bold text-[#557d78] hover:bg-[#f0f7f4]"
                          >
                            {t("pg.cancel")}
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-[11px] font-semibold text-[#93aaa3]">
                        {t("pg.newCityHint", { country: data.trip.country || "—" })}
                      </p>
                      {cityError ? (
                        <p role="alert" className="mt-1 text-[11.5px] font-bold text-[#c43d3d]">{cityError}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Hotels live in a POPUP, not inline. The agent enters the
                      cities first; the chosen hotels show here beside the name,
                      small, and «الفنادق» opens the popup to add or edit them. */}
                  {showHotels && ownsStays ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#e7f0ec] pt-3">
                      {city.city_name.trim() ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setHotelsFor(cityIndex);
                              setChoosing(null);
                              resetPicker();
                            }}
                            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white transition-colors hover:bg-[#0f4439]"
                          >
                            <BedDouble className="size-3.5" />
                            {t("pg.cityHotels")}
                          </button>
                          {cov ? (
                            <span
                              className={`tv-tnum rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                                short ? "bg-[#fff8e8] text-[#a86a10]" : "bg-[#e9f7f0] text-[#0f7a52]"
                              }`}
                            >
                              <DirText dir="ltr">{`${cov.covered}/${cov.needed}`}</DirText> ليالٍ مغطّاة
                            </span>
                          ) : null}
                          {cov && cov.stays.some((s) => s.line.hotel_name.trim()) ? (
                            <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-[#557d78]">
                              {cov.stays
                                .map((s) => s.line.hotel_name)
                                .filter((n) => n.trim())
                                .join(" · ")}
                            </span>
                          ) : (
                            <span className="text-[11.5px] font-semibold text-[#a86a10]">{t("pg.cityNoHotelYet")}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-[11.5px] font-bold text-[#93aaa3]">{t("pg.chooseCityFirst")}</span>
                      )}
                    </div>
                  ) : null}

                  {done ? (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setExpanded(null)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#bfe5d4] bg-[#e9f7f0] px-3.5 text-[12px] font-bold text-[#0f7a52] transition-colors hover:bg-[#dff3ea]"
                      >
                        <CheckCircle2 className="size-3.5" />
                        {t("pg.cityDone")}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {/* The hotels of ONE city, opened from its row. State (which card is
            choosing, the picker) is component-level, so it behaves the same in
            here as it did inline — only the city on screen is scoped down. */}
        <Dialog
          open={hotelsFor !== null}
          onOpenChange={(open) => {
            if (!open) {
              setHotelsFor(null);
              setChoosing(null);
              resetPicker();
            }
          }}
        >
          <DialogContent className="w-[min(960px,calc(100vw/var(--tv-zoom)_-_24px))]" dir="rtl">
            {(() => {
              if (hotelsFor === null) return null;
              const city = data.cities[hotelsFor];
              if (!city) return null;
              const cov = coverage.find((c) => c.city_name === city.city_name);
              const hotelOptions = country?.cities.find((c) => c.name === city.city_name)?.hotels ?? [];
              // No coverage means the city has no name or no nights yet — nothing
              // to pick a hotel for. (Also narrows `cov` for the block below.)
              if (!cov) {
                return <p className="text-[12.5px] font-semibold text-[#93aaa3]">{t("pg.chooseCityFirst")}</p>;
              }
              return (
                <div className="space-y-3">
                  {/* pe-10 keeps the title clear of the dialog's own close button */}
                  <h3 className="pe-10 text-sm font-extrabold text-[#003c3a]">
                    {t("pg.cityHotels")} — {city.city_name}
                  </h3>
                  <div className="space-y-3">
                    {cov.stays.map((stay, stayIndex) => {
                      const line = stay.line;
                      const roomTypeOptions = lookups.roomTypes.filter(
                        (rt) => rt.hotel_id === line.hotel_id || rt.hotel_id === null,
                      );
                      const isChoosing = openLine === line.id;

                      return (
                        <StayCard
                          key={`${hotelsFor}-${line.id}`}
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
                          countries={lookups.countries}
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
                              onNights: (n) => setHotel(line.id, { nights: n }),
                              onGuests: (g) => setGuests(line, g),
                              hotelNames: hotelOptions.map((h) => h.name),
                            },
                            sources,
                            source: sourceFor(line),
                            countryName: data.trip.country,
                            onHotelCreated: (hotel) =>
                              void select(
                                cov.city_name,
                                line,
                                { source: "internal", id: hotel.id, name: hotel.name, name_en: hotel.name_en, stars: hotel.stars, image: null, rates: [] },
                                null,
                              ),
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
                          onDone={() => handOver(line.id)}
                          onRefresh={() => {
                            setChoosing(line.id);
                            resetPicker();
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e7f0ec] pt-3">
                    <button
                      type="button"
                      onClick={() => addStay(cov.city_name)}
                      className="inline-flex h-10 items-center gap-1 rounded-[10px] border border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
                    >
                      <Plus className="size-3.5" />
                      فندق آخر
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveHotels()}
                      className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#185045] px-5 text-[12.5px] font-bold text-white transition-colors hover:bg-[#0f4439]"
                    >
                      <Check className="size-4" />
                      {t("pg.saveHotels")}
                    </button>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>

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
