"use client";

import { Fragment, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BedDouble,
  Camera,
  CheckCircle2,
  ChevronDown,
  GripVertical,
  ListChecks,
  Pencil,
  Plane,
  Plus,
  RotateCcw,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  addStay,
  BOARD_LABEL_KEYS,
  BOARD_TYPES,
  cityHotelLines,
  currencyOptions,
  hopMode,
  vehicleText,
  deriveHotelStays,
  emptyRoomSpec,
  findLookupCountry,
  tourCars,
  withRooms,
  type DraftData,
  type DraftHotel,
  type DraftRoomSpec,
  type GeneratorLookups,
  type TourPick,
  type TransportLeg,
} from "@/lib/offer/draft-types";
import {
  baseRoomName,
  changeRoom,
  clearRoomChange,
  EXTRA_BED,
  roomChangeLine,
  airportDisplay,
  cityDates,
  findAirport,
  rankAirports,
  roomSuggestions,
  setCityNights,
  tripCountries,
  withTours,
  type BasicCity,
} from "@/lib/offer/basic";
import { arrivalLines, departureDay, departureLines, legInto, type TourProgram } from "@/lib/offer/itinerary";
import { localDatePart } from "@/lib/offer/schedule";
import { BasicCityProgram } from "./BasicCityProgram";
import { SuggestInput } from "../SuggestInput";
import { useRole } from "@/lib/roles/RoleContext";
import { tourPriced, toursTotal, type TourPrice } from "@/lib/offer/pricing-suggest";
import type { BoardType } from "@/lib/types";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { suppliersFor } from "../generator/SupplierPrice";
import { AddStayMenu, StayDatesLine } from "../generator/hotels/StayDates";
import { FlightFare } from "../generator/flights/FlightFare";
import { withTypedTotal } from "@/lib/offer/flight-fare";
import { basicField, typedNumber } from "./styles";
import { HotelCombobox } from "./HotelCombobox";
import { RefundControl } from "../generator/hotels/RefundControl";
import { nightsText, useBasicLabels } from "./labels";
import { CarCountSelect, CarOptions, TourRow, type TourCatalog } from "../tours/TourRow";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const money = (n: number) => Math.round(n * 100) / 100;
const DAY = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" });
/** «20 أكتوبر – 24 أكتوبر» */
const span = (c: { check_in: string | null; check_out: string | null }) =>
  c.check_in && c.check_out ? `${SHORT.format(new Date(`${c.check_in}T00:00:00Z`))} – ${SHORT.format(new Date(`${c.check_out}T00:00:00Z`))}` : "—";
/** «الأربعاء، 11 نوفمبر» */
const dayLabel = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

type Tab = "hotel" | "tours" | "domestic" | "program";

/**
 * The card's tables share one look: a row of small headings once, then rows of
 * bare fields aligned under them — rather than a label over every field, which
 * spread a city over half a screen. Below xl the rows wrap two to a line.
 */
const head = "hidden px-0.5 text-[10.5px] font-bold text-[#7a948f] xl:grid";
const rowGap = "grid grid-cols-2 items-start gap-2";
const HOTEL_COLS = "xl:grid-cols-[minmax(12rem,1.6fr)_minmax(10rem,1.4fr)_minmax(7.5rem,0.9fr)_7rem_minmax(7rem,0.8fr)_2rem]";
const TOUR_COLS = "xl:grid-cols-[minmax(9.5rem,1fr)_minmax(13rem,2fr)_minmax(9rem,1fr)_4.5rem_minmax(6.5rem,0.7fr)_minmax(6.5rem,0.7fr)]";
/** the same rows without the price per car and the total — for a viewer without pricing.view. */
const TOUR_COLS_NO_PRICE = "xl:grid-cols-[minmax(9.5rem,1fr)_minmax(13rem,2fr)_minmax(9rem,1fr)_4.5rem]";

/** «عدد الجولات: 2 · الإجمالي: 800» — without a total (no pricing.view), the count alone. */
const toursText = (tx: ReturnType<typeof useBasicLabels>, n: number, total: number | null) =>
  total == null ? `${tx("toursCount")}: ${n}` : tx("toursSummary", { n, total: total.toLocaleString("en-US") });

/**
 * One city: its tabs in the header beside its name — the hotel, the tours (with
 * the airport reception / farewell beside them), the domestic flights — one open
 * at a time.
 * Everything the trip already said (dates, meals, currency) is filled in for
 * the agent and kept under «معلومات إضافية».
 */
export function BasicCityCard({
  index,
  city,
  dayFrom,
  data,
  lookups,
  programs,
  tourPrices,
  hotelsOn,
  toursOn,
  transportOn,
  isFirst,
  isLast,
  hop,
  onNights,
  onPicks,
  onLines,
  onSlice,
  onCar,
  onRemove,
  onMove,
  dragFrom,
  onDragFrom,
  onReplace,
  datesWere,
  collapsed,
  onDone,
  onExpand,
}: {
  index: number;
  city: BasicCity;
  dayFrom: number;
  data: DraftData;
  lookups: GeneratorLookups;
  /** the ready-made tours of this city (tour_programs). */
  programs: TourProgram[];
  /** the company's tours price list for the trip's countries — a pick fills its price. */
  tourPrices: TourPrice[];
  hotelsOn: boolean;
  toursOn: boolean;
  transportOn: boolean;
  /** the city the group lands in, and the one it flies home from. */
  isFirst: boolean;
  isLast: boolean;
  /** how the group gets here from the previous city, when the trip moves more than one way. */
  hop?: ReactNode;
  onNights: (nights: number) => void;
  /** the city's tours, in date order — their count is the city's tour count. */
  onPicks: (picks: TourPick[]) => void;
  /** replace these hotel lines (matched by id) — several at once, from one change. */
  onLines: (lines: DraftHotel[]) => void;
  onSlice: (slice: Partial<DraftData>) => void;
  /** the reception (airport), farewell or the trip's tours car changed. */
  onCar: (leg: "airport" | "farewell" | "tours", slice: Partial<TransportLeg>) => void;
  onRemove: () => void;
  /** the city at `from` goes to `to` — dropped on this card, or this card's arrows. */
  onMove: (from: number, to: number) => void;
  /** the city being dragged, while a drag is on. */
  dragFrom: number | null;
  onDragFrom: (index: number | null) => void;
  /** «تعديل المدينة»: another city in this place, its nights and tour days kept. */
  onReplace: (city: { name: string; country?: string }) => void;
  /** what the dates were before the order changed — the card is red until «تمت». */
  datesWere?: { check_in: string | null; check_out: string | null; prev?: string } | null;
  /** «تمت» pressed: the card folds to its summary line. */
  collapsed: boolean;
  onDone: () => void;
  onExpand: () => void;
}) {
  const tx = useBasicLabels();
  // this stop's own stays — a city visited twice has two sets
  const lines = cityHotelLines(data.cities, data.hotels, index);
  const [main] = lines;
  const domestic = data.flights.filter(
    (f) => f.leg_order === "internal" && (f.to_city?.trim() === city.city_name || f.from_city?.trim() === city.city_name),
  );
  // reached by a domestic flight from another city — its airport transfers show on the tours tab
  const before = index > 0 ? data.cities[index - 1] : undefined;
  const byAir = Boolean(before && before.city_name !== city.city_name && hopMode(data.transport_plan, before.city_name, city.city_name) === "flight");
  // «البرنامج السياحي» opens once every tour of the city says what it is
  const picks = toursOn ? withTours(city, city.tours ?? 0, undefined, isLast) : [];
  const programLocked = picks.some((p) => !p.free && !p.title.trim());
  const tabs: { key: Tab; label: string; icon: typeof Plane; locked?: boolean }[] = [
    ...(hotelsOn && main ? [{ key: "hotel" as const, label: tx("hotel"), icon: BedDouble }] : []),
    // the tours, and the reception / farewell cars beside them on the first and last city
    ...(toursOn || (transportOn && (isFirst || isLast || byAir))
      ? [{ key: "tours" as const, label: toursOn ? tx("tours") : tx("transfersTab"), icon: toursOn ? Camera : UserRound }]
      : []),
    ...(domestic.length > 0 || (data.scope.flights_domestic && index > 0) ? [{ key: "domestic" as const, label: tx("domesticTab"), icon: Plane }] : []),
    { key: "program" as const, label: tx("programTab"), icon: ListChecks, locked: programLocked },
  ];
  // a stay already complete (picked from the add bar, or a file reopened) is not asked again: the card opens on what is left
  const stayDone = (ls: DraftHotel[]) =>
    ls.length > 0 && ls.every((l) => l.hotel_name.trim() && l.rooms.length > 0 && l.rooms.every((r) => (r.room_type_id || r.room_type_name.trim()) && r.board_type && r.price != null));
  const hasTours = tabs.some((x) => x.key === "tours");
  const [tab, setTab] = useState<Tab>(() => (hotelsOn && hasTours && stayDone(lines) ? "tours" : "hotel"));
  // focus left the hotel fields: once the stay is complete the card moves on by itself
  const [leftHotel, setLeftHotel] = useState(false);
  const wanted = leftHotel && tab === "hotel" && hasTours && stayDone(lines) ? "tours" : tab;
  const open = tabs.some((x) => x.key === wanted && !x.locked) ? wanted : tabs[0]?.key;
  const pickTab = (key: Tab) => {
    setLeftHotel(false);
    setTab(key);
  };

  // what the city still lacks before «تمت»: the stay, the tours, the airport cars
  const plan = data.transport_plan;
  const tripCar = plan.tours.car_type.trim();
  // the tours' prices, as the generator shows them: pricing.view only (a hidden price is kept, never cleared)
  const showPrice = useRole().can("pricing.view");
  const rooms = lines.flatMap((l) => l.rooms);
  const missing = [
    hotelsOn && lines.some((l) => !l.hotel_name.trim()) && tx("hotel"),
    hotelsOn && rooms.some((r) => !(r.room_type_id || r.room_type_name.trim())) && tx("roomType"),
    hotelsOn && rooms.some((r) => !r.board_type) && tx("board"),
    hotelsOn && rooms.some((r) => r.price == null) && tx("price"),
    picks.some((p) => !p.free && !p.title.trim()) && tx("tourService"),
    picks.some((p) => !p.free && !(p.car_type?.trim() || tripCar)) && tx("carType"),
    // a tour the list prices is priced (the sheet takes the list's figure) — asked only of who sees the price
    showPrice && picks.some((p) => !tourPriced(p, tripCar, tourPrices)) && tx("tourPrice"),
    transportOn && isFirst && !plan.airport.car_type.trim() && tx("reception"),
    transportOn && isLast && !(plan.farewell ?? plan.airport).car_type.trim() && tx("farewell"),
  ].filter((x): x is string => Boolean(x));
  const stayPrice = rooms.reduce((sum, r) => sum + (r.price ?? 0), 0);
  const tours = picks.filter((p) => !p.free);
  const summary = [
    [...new Set(lines.map((l) => l.hotel_name.trim()).filter(Boolean))].join(" + "),
    main && main.rooms.length > 0 ? `${main.rooms.length} × ${baseRoomName(main.rooms[0].room_type_name) || "—"}` : "",
    hotelsOn && stayPrice > 0 ? `${stayPrice.toLocaleString("en-US")} ${main?.manual_currency ?? ""}`.trim() : "",
    toursOn ? toursText(tx, tours.length, showPrice ? toursTotal(tours, tripCar, tourPrices, lookups.sarPer ?? { SAR: 1 }) : null) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // the order: a city dragged by its handle and dropped on another takes its place
  const card = useRef<HTMLElement>(null);
  const target = dragFrom !== null && dragFrom !== index;
  // the card the dragged city is over — it goes in above it
  const [over, setOver] = useState(false);
  // «تعديل المدينة»
  const [editing, setEditing] = useState(false);
  const [editCountry, setEditCountry] = useState(city.country || data.trip.country);
  const [editCity, setEditCity] = useState(city.city_name);
  const editCities = editing ? (findLookupCountry(lookups.countries, editCountry)?.cities ?? []) : [];
  const moved = Boolean(datesWere);

  return (
    <article
      ref={card}
      id={`basic-city-${index}`}
      onDragOver={(e) => {
        if (dragFrom === null) return;
        // the drop is the card's, never a field's under the pointer
        e.preventDefault();
        e.dataTransfer.dropEffect = target ? "move" : "none";
        if (target && !over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        setOver(false);
        // dropped on a card, the city goes in above it — wherever it came from
        if (target) onMove(dragFrom, dragFrom < index ? index - 1 : index);
        onDragFrom(null);
      }}
      className={`scroll-mt-20 overflow-hidden rounded-[14px] border bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)] ${
        target ? "border-dashed border-[#2aa87a]" : moved ? "border-[#f1b5b5]" : "border-[#d8e6e0]"
      } ${over ? "border-t-4 border-t-[#2aa87a] shadow-[0_-6px_0_rgba(42,168,122,0.15)]" : ""} ${dragFrom === index ? "opacity-50" : ""}`}
    >
      {/* the city, its tabs and its nights — one line */}
      <header className={`flex flex-wrap items-center gap-2 px-3 py-2 ${moved ? "bg-[#fdecec]" : "bg-[#eef5f2]"}`}>
        <span
          draggable
          role="button"
          tabIndex={-1}
          aria-label={tx("dragCity")}
          title={tx("dragCity")}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            // not text/plain: dropped on a field by mistake, the city's number would be typed into it
            e.dataTransfer.setData("application/x-basic-city", String(index));
            if (card.current) {
              const r = card.current.getBoundingClientRect();
              e.dataTransfer.setDragImage(card.current, e.clientX - r.left, e.clientY - r.top);
            }
            // after the browser has taken the picture — the card fades only then
            window.setTimeout(() => onDragFrom(index), 0);
          }}
          onDragEnd={() => onDragFrom(null)}
          className="cursor-grab text-[#7a948f] hover:text-[#185045] active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>
        <span className={`flex size-6 items-center justify-center rounded-full text-[11px] font-extrabold text-white ${moved ? "bg-[#c43d3d]" : "bg-[#185045]"}`}>{index + 1}</span>
        <h3 className="text-[13.5px] font-extrabold text-[#0f3d38]">{city.city_name}</h3>
        {city.country ? <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold text-[#557d78]">{city.country}</span> : null}
        {hop}
        {tabs.length > 0 && !collapsed ? (
          <div role="tablist" className="flex flex-wrap gap-1 sm:ms-3">
            {tabs.map(({ key, label, icon: Icon, locked }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={open === key}
                disabled={locked}
                title={locked ? tx("programLocked") : undefined}
                onClick={() => pickTab(key)}
                className={`inline-flex h-7 items-center gap-1 rounded-[7px] border px-2.5 text-[11.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  open === key ? "border-[#185045] bg-[#185045] text-white" : "border-[#d3e2dc] bg-white text-[#557d78] hover:border-[#165749]"
                }`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="ms-auto flex items-center gap-2">
          {/* the arrows do what the drag does — on a phone, and from the keyboard */}
          <span className="inline-flex items-center">
            <button type="button" disabled={isFirst} onClick={() => onMove(index, index - 1)} aria-label={tx("moveUp")} title={tx("moveUp")} className="rounded-[7px] p-1 text-[#557d78] hover:bg-white disabled:opacity-30">
              <ArrowUp className="size-3.5" />
            </button>
            <button type="button" disabled={isLast} onClick={() => onMove(index, index + 1)} aria-label={tx("moveDown")} title={tx("moveDown")} className="rounded-[7px] p-1 text-[#557d78] hover:bg-white disabled:opacity-30">
              <ArrowDown className="size-3.5" />
            </button>
          </span>
          <button
            type="button"
            onClick={() => {
              setEditCountry(city.country || data.trip.country);
              setEditCity(city.city_name);
              setEditing((v) => !v);
            }}
            aria-expanded={editing}
            className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#d3e2dc] bg-white px-2 text-[11px] font-bold text-[#185045] hover:border-[#165749]"
          >
            <Pencil className="size-3.5" />
            {tx("editCity")}
          </button>
          <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#185045]">
            {tx("nights")}
            <select value={city.nights} onChange={(e) => onNights(Number(e.target.value))} className="h-7 rounded-[7px] border border-[#cfe0d9] bg-white px-1 text-[12px] font-bold">
              {range(1, 30).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onRemove} aria-label={tx("removeCity")} className="rounded-[7px] p-1 text-[#c43d3d] hover:bg-[#fff1f1]">
            <Trash2 className="size-4" />
          </button>
        </div>
      </header>

      {/* «تعديل المدينة»: another city, the same place in the trip */}
      {editing ? (
        <div className="flex flex-wrap items-end gap-2 border-b border-[#DCE9E5] bg-[#f7fbf9] px-3 py-2">
          <Field label={tx("country")} className="w-40">
            <select
              value={findLookupCountry(lookups.countries, editCountry)?.name ?? ""}
              onChange={(e) => {
                setEditCountry(e.target.value);
                setEditCity("");
              }}
              className={`${basicField} px-1.5`}
            >
              <option value="">{tx("choose")}</option>
              {lookups.countries.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label={tx("city")} className="min-w-40 flex-1">
            <select value={editCity} onChange={(e) => setEditCity(e.target.value)} className={basicField}>
              <option value="">{tx("choose")}</option>
              {editCity && !editCities.some((c) => c.name === editCity) ? <option value={editCity}>{editCity}</option> : null}
              {editCities.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            disabled={!editCity}
            onClick={() => {
              onReplace({ name: editCity, country: findLookupCountry(lookups.countries, editCountry)?.name ?? editCountry });
              setEditing(false);
            }}
            className="inline-flex h-9 items-center gap-1 rounded-[8px] bg-[#185045] px-3 text-[12px] font-extrabold text-white disabled:opacity-50"
          >
            <CheckCircle2 className="size-3.5" />
            {tx("saveCity")}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="inline-flex h-9 items-center px-2 text-[12px] font-bold text-[#557d78] hover:text-[#185045]">
            {tx("cancelEdit")}
          </button>
          <p className="basis-full text-[11px] font-semibold text-[#7a948f]">{tx("editCityHint")}</p>
        </div>
      ) : null}

      {/* the order changed and with it the dates: red until the agent has looked again */}
      {datesWere ? (
        <p role="status" className="tv-tnum flex flex-wrap items-center gap-1.5 bg-[#fff5f5] px-3 py-1.5 text-[11.5px] font-bold text-[#b42318]">
          <AlertTriangle className="size-3.5 shrink-0" />
          {datesWere.check_in === city.check_in && datesWere.check_out === city.check_out
            ? tx("hopMoved", { from: data.cities[index - 1]?.city_name ?? "—" })
            : tx("datesMoved", { was: span(datesWere), now: span(city) })}
        </p>
      ) : null}

      {collapsed ? (
        // done: one line — what the city holds, and a press reopens it
        <button
          type="button"
          onClick={onExpand}
          className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-[#f7fbf9]"
        >
          {moved ? (
            <AlertTriangle className="size-4 shrink-0 text-[#c43d3d]" />
          ) : (
            <CheckCircle2 className={`size-4 shrink-0 ${missing.length > 0 ? "text-[#a86a10]" : "text-[#0f7a52]"}`} />
          )}
          <span className="tv-tnum min-w-0 flex-1 truncate text-[12px] font-semibold text-[#557d78]">
            {missing.length > 0 ? tx("needFirst", { list: missing.join("، ") }) : summary || city.city_name}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-bold text-[#185045]">
            <Pencil className="size-3.5" />
            {tx("edit")}
          </span>
        </button>
      ) : open ? (
        <div className="p-3">
          {open === "hotel" && main ? (
            // leaving a complete stay moves on to the tours — never mid-typing; «الفندق» brings it back
            <div
              onFocus={() => setLeftHotel(false)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setLeftHotel(true);
              }}
            >
              <HotelPanel index={index} city={city} dayFrom={dayFrom} data={data} lookups={lookups} lines={lines} onLines={onLines} onSlice={onSlice} />
            </div>
          ) : null}
          {open === "tours" ? (
            <ToursPanel
              index={index}
              city={city}
              programs={programs}
              tourPrices={tourPrices}
              sarPer={lookups.sarPer ?? { SAR: 1 }}
              data={data}
              carTypes={lookups.carTypes}
              isFirst={isFirst}
              isLast={isLast}
              toursOn={toursOn}
              transportOn={transportOn}
              showPrice={showPrice}
              onPicks={onPicks}
              onCar={onCar}
              onSlice={onSlice}
            />
          ) : null}
          {open === "program" ? (
            <BasicCityProgram
              city={city}
              data={data}
              dayLabel={dayLabel}
              onSlice={onSlice}
              onTours={() => pickTab("tours")}
              catalog={{
                city: city.city_name,
                programs,
                prices: tourPrices,
                sarPer: lookups.sarPer ?? { SAR: 1 },
                carTypes: lookups.carTypes,
                tripCar: plan.tours.car_type,
                showPrice,
              }}
            />
          ) : null}
          {open === "domestic" ? (
            <DomesticPanel legs={domestic} data={data} lookups={lookups} onSlice={onSlice} />
          ) : null}
          {/* «تمت <city>»: open only when the city has all it needs, and says what is missing until then */}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-dashed border-[#DCE9E5] pt-2.5">
            {missing.length > 0 ? <span className="text-[11.5px] font-bold text-[#a86a10]">{tx("needFirst", { list: missing.join("، ") })}</span> : null}
            <button
              type="button"
              onClick={onDone}
              disabled={missing.length > 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#185045] px-4 text-[12px] font-extrabold text-white hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="size-3.5" />
              {tx("cityDone", { city: city.city_name })}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

// ---------- the panels ----------

function HotelPanel({
  index,
  city,
  dayFrom,
  data,
  lookups,
  lines,
  onLines,
  onSlice,
}: {
  index: number;
  city: BasicCity;
  dayFrom: number;
  data: DraftData;
  lookups: GeneratorLookups;
  /** this stop's stays, in order — each with its own hotel. */
  lines: DraftHotel[];
  onLines: (lines: DraftHotel[]) => void;
  onSlice: (slice: Partial<DraftData>) => void;
}) {
  const tx = useBasicLabels();
  const { t, language } = useTraveliunUI();
  const [more, setMore] = useState(false);
  const stays = deriveHotelStays(data.cities, data.hotels).filter((s) => s.city_index === index);
  const [main] = lines;
  // the same hotel, another room after some nights — it follows the first stay's hotel and rooms
  const change = roomChangeLine(lines);
  const mainNights = Math.max(stays[0]?.nights ?? city.nights, 1);
  const hotels =
    findLookupCountry(lookups.countries, city.country || data.trip.country)?.cities.find((c) => c.name === city.city_name)?.hotels ?? [];

  /** The same answer for every stay of this city — the currency, the supplier. */
  const allLines = (fn: (line: DraftHotel) => DraftHotel) => onLines(lines.map(fn));
  /** A change to the first stay reaches its room change too; any other stay is its own. */
  const follow = (line: DraftHotel, fn: (line: DraftHotel) => DraftHotel) =>
    onLines(line.id === main.id && change ? [fn(line), fn(change)] : [fn(line)]);
  const setRoom = (line: DraftHotel, j: number, slice: Partial<DraftRoomSpec>) =>
    withRooms({ ...line, sourcing: null }, line.rooms.map((r, k) => (k === j ? { ...r, ...slice } : r)));

  const priceField = (value: number | null, nights: number, currency: string, onValue: (v: number | null) => void, label: string) => (
    <span className="grid gap-0.5">
      <input
        type="number"
        min={0}
        dir="ltr"
        aria-label={label}
        title={label}
        value={value ?? ""}
        placeholder={tx("price")}
        onChange={(e) => onValue(typedNumber(e.target))}
        className={`${basicField} tv-tnum text-center`}
      />
      {value != null ? (
        <span className="tv-tnum text-[10px] font-bold text-[#0f7a52]">
          {tx("perNightIs", { price: `${money(value / nights).toLocaleString("en-US")} ${currency}` })}
        </span>
      ) : null}
    </span>
  );

  return (
    <div className="space-y-1.5">
      <div className={`${head} ${HOTEL_COLS} gap-2`}>
        <span>{tx("hotel")}</span>
        <span>{tx("roomType")}</span>
        <span>{tx("board")}</span>
        <span>{tx("extraBed")}</span>
        <span>{tx("stayPrice", { n: nightsText(mainNights, language) })}</span>
        <span />
      </div>

      {/* every stay of the city: its hotel on the first room's row, each further room under it */}
      {lines.map((line, i) => {
        const stay = stays[i];
        const nights = Math.max(stay?.nights ?? city.nights, 1);
        const priceTitle = tx("stayPrice", { n: nightsText(nights, language) });
        // a hotel the list does not hold (an older file) still shows its name
        const outside = line.hotel_name && !hotels.some((h) => h.id === line.hotel_id) ? (line.hotel_id ?? "__current") : null;
        const rooms = roomSuggestions(lookups.roomTypes, line.hotel_id).map((value) => ({ value }));
        return (
          <div key={line.id} className={i > 0 ? "space-y-1.5 border-t border-dashed border-[#DCE9E5] pt-2" : "space-y-1.5"}>
            {lines.length > 1 && stay ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11.5px] font-extrabold text-[#185045]">{`${tx("hotel")} ${i + 1}`}</span>
                <StayDatesLine stay={stay} city={city} inputClass={basicField} onChange={(slice) => onLines([{ ...line, ...slice }])} />
                {i > 0 ? (
                  <button
                    type="button"
                    onClick={() => onSlice({ hotels: data.hotels.filter((h) => h.id !== line.id) })}
                    aria-label={t("pg.stay.remove")}
                    title={t("pg.stay.remove")}
                    className="ms-auto rounded-[7px] p-1 text-[#c43d3d] hover:bg-[#fff1f1]"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ) : null}
            {line.rooms.map((r, j) => {
              const extra = r.room_type_name.endsWith(EXTRA_BED);
              return (
                <div key={j} className={`${rowGap} ${HOTEL_COLS}`}>
                  {j === 0 ? (
                    <HotelCombobox
                      hotels={hotels}
                      valueId={line.hotel_id}
                      currentName={outside ? line.hotel_name : null}
                      placeholder={`${tx("hotel")} — ${tx("choose")}`}
                      onPick={(h) =>
                        follow(line, (l) =>
                          withRooms(
                            { ...l, hotel_id: h?.id ?? null, hotel_name: h?.name ?? "", hotel_name_en: "", sourcing: null },
                            // a room type belongs to its hotel: the old hotel's id must not follow
                            l.rooms.map((room) => ({ ...room, room_type_id: null })),
                          ),
                        )
                      }
                      className="col-span-2 xl:col-span-1"
                    />
                  ) : (
                    <span className="col-span-2 inline-flex h-9 items-center text-[11.5px] font-extrabold text-[#185045] xl:col-span-1 xl:justify-end xl:pe-2">
                      {tx("roomN", { n: j + 1 })}
                    </span>
                  )}
                  <SuggestInput
                    ariaLabel={tx("roomType")}
                    placeholder={tx("roomType")}
                    items={rooms}
                    value={baseRoomName(r.room_type_name)}
                    onChange={(value) => onLines([setRoom(line, j, { room_type_id: null, room_type_name: value + (extra ? EXTRA_BED : "") })])}
                    className={basicField}
                  />
                  <select
                    aria-label={tx("board")}
                    value={r.board_type ?? ""}
                    onChange={(e) => onLines([setRoom(line, j, { board_type: (e.target.value || null) as BoardType | null })])}
                    className={basicField}
                  >
                    <option value="">{tx("board")}</option>
                    {BOARD_TYPES.map((b) => (
                      <option key={b} value={b}>{t(BOARD_LABEL_KEYS[b])}</option>
                    ))}
                  </select>
                  <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-[#dbe6e1] bg-white px-2 text-[11.5px] font-bold text-[#185045]">
                    <input
                      type="checkbox"
                      checked={extra}
                      onChange={(e) => onLines([setRoom(line, j, { room_type_name: baseRoomName(r.room_type_name) + (e.target.checked ? EXTRA_BED : "") })])}
                      className="size-3.5 accent-[#185045]"
                    />
                    {tx("extraBed")}
                  </label>
                  {priceField(r.price, nights, line.manual_currency, (price) => onLines([setRoom(line, j, { price })]), priceTitle)}
                  {line.rooms.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => follow(line, (l) => withRooms(l, l.rooms.filter((_, k) => k !== j)))}
                      aria-label={tx("removeRoom")}
                      className="inline-flex size-9 items-center justify-center rounded-[8px] text-[#c43d3d] hover:bg-[#fff1f1]"
                    >
                      <X className="size-4" />
                    </button>
                  ) : (
                    <span className="max-xl:hidden" />
                  )}
                </div>
              );
            })}
            {/* refundable — part of the price, so under the price column (a supplier rate states its own) */}
            {!line.sourcing ? (
              <div className={`${rowGap} ${HOTEL_COLS}`}>
                <span className="max-xl:hidden xl:col-span-4" />
                <div className="col-span-2">
                  <RefundControl
                    refundable={line.refundable}
                    until={line.refundable_until}
                    onChange={(v) => follow(line, (l) => ({ ...l, ...v }))}
                    labels={{ yes: tx("refundable"), no: tx("nonRefundable"), until: tx("refundUntil") }}
                  />
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 pt-0.5">
              {/* a new room is a room of its own: its type and price are asked, the board follows */}
              <button
                type="button"
                // a new room starts as the one before it — type, board and price — and is changed if it differs
                onClick={() => follow(line, (l) => withRooms(l, [...l.rooms, { ...(l.rooms[l.rooms.length - 1] ?? emptyRoomSpec()) }]))}
                className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-dashed border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
              >
                <Plus className="size-3.5" />
                {tx("addRoom")}
              </button>
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-3 border-t border-dashed border-[#DCE9E5] pt-2">
        <AddStayMenu
          label={t("pg.stay.addInCity")}
          onAdd={(dates) => onSlice({ hotels: addStay(data.cities, data.hotels, index, dates).hotels })}
          className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-dashed border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
        />
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className="inline-flex h-7 items-center gap-1 text-[11.5px] font-bold text-[#557d78] hover:text-[#185045]"
        >
          {tx("moreInfo")}
          <ChevronDown className={`size-3.5 transition-transform ${more ? "rotate-180" : ""}`} />
        </button>
        {more ? (
          <span className="tv-tnum text-[11px] font-bold text-[#7a948f]">
            {tx("dayRange", { from: dayFrom, to: dayFrom + city.nights })}
            {lines.length === 1 ? stays.map((s) => (s.check_in ? ` · ${tx("stayDates", { in: s.check_in, out: s.check_out ?? "" })}` : "")) : null}
          </span>
        ) : null}
      </div>

      {/* the rarely-changed answers, on one short line */}
      {more ? (
        <div className="flex flex-wrap items-end gap-2 rounded-[10px] bg-[#f8fbf9] p-2">
          <Field label={tx("currency")} className="w-24">
            <select value={main.manual_currency} onChange={(e) => allLines((line) => ({ ...line, manual_currency: e.target.value }))} className={basicField}>
              {currencyOptions(lookups.countries, main.manual_currency).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          {/* who the room was bought from — internal, never on the client document */}
          <Field label={t("pg.supplierLabel")} className="w-48">
            <select value={main.supplier ?? ""} onChange={(e) => allLines((line) => ({ ...line, supplier: e.target.value }))} className={basicField}>
              <option value="">{tx("choose")}</option>
              {suppliersFor(lookups, "فنادق").map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          </Field>
          {/* a room change is the first stay's: the new room is typed on its own row above */}
          {city.nights > 1 ? (
            <Field label={tx("roomChange")} className="w-36">
              <select
                value={change ? mainNights : ""}
                onChange={(e) =>
                  onSlice(
                    e.target.value === ""
                      ? clearRoomChange(data, index)
                      : changeRoom(data, index, Number(e.target.value), change ? baseRoomName(change.rooms[0]?.room_type_name ?? "") : ""),
                  )
                }
                className={basicField}
              >
                <option value="">{tx("none")}</option>
                {range(1, city.nights - 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A small labelled field for the short lines. */
function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`grid gap-1 text-[10.5px] font-bold text-[#7a948f] ${className ?? ""}`}>
      {label}
      {children}
    </label>
  );
}

/**
 * The city's tours, and on the first and last city the airport reception and
 * farewell beside them — one tab for every car the group rides in.
 *
 * The tours read as the city's days, in order (the generator's «البرنامج
 * اليومي والجولات», compact — no weather, no AI): a day with a tour holds its
 * row (TourRow, shared with the generator), a day without one says what it is
 * and takes one with a press — the arrival day too («جولة بعد الوصول»), and
 * on the last city the day home («جولة قبل المغادرة»: the tour, then the
 * farewell). The count is still set here (any number — a client may want more
 * tours than days). The tours car is chosen once for the whole trip; a tour
 * given another car keeps its own, and its cars follow the trip's while they
 * were the same. The price per car and the total show with pricing.view only.
 */
function ToursPanel({
  index,
  city,
  programs,
  tourPrices,
  sarPer,
  data,
  carTypes,
  isFirst,
  isLast,
  toursOn,
  transportOn,
  showPrice,
  onPicks,
  onCar,
  onSlice,
}: {
  index: number;
  city: BasicCity;
  programs: TourProgram[];
  tourPrices: TourPrice[];
  sarPer: Record<string, number>;
  data: DraftData;
  carTypes: GeneratorLookups["carTypes"];
  isFirst: boolean;
  isLast: boolean;
  toursOn: boolean;
  transportOn: boolean;
  /** pricing.view: the price per car and the total. */
  showPrice: boolean;
  onPicks: (picks: TourPick[]) => void;
  onCar: (leg: "airport" | "farewell" | "tours", slice: Partial<TransportLeg>) => void;
  onSlice: (slice: Partial<DraftData>) => void;
}) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const plan = data.transport_plan;
  const tripCar = plan.tours.car_type;
  const cols = showPrice ? TOUR_COLS : TOUR_COLS_NO_PRICE;
  // every night of the city may hold a tour, and on the last city the day home; a new one goes in the trip's tour cars
  const leaving = isLast ? departureDay(city) : null;
  const dates = leaving ? [...cityDates(city), leaving] : cityDates(city);
  const picks = withTours(city, city.tours ?? 0, plan.tours.cars, isLast);
  const catalog: TourCatalog = { city: city.city_name, programs, prices: tourPrices, sarPer, carTypes, tripCar, showPrice };
  // a tour put on the day home is «قبل المغادرة»; moved off it, a tour of the city's nights
  const onDay = (p: TourPick): TourPick => ({ ...p, departure: leaving !== null && p.date === leaving ? true : undefined });
  const setPick = (k: number, slice: Partial<TourPick>) => onPicks(picks.map((p, i) => (i === k ? onDay({ ...p, ...slice }) : p)));
  const addOn = (date: string) => onPicks([...picks, onDay({ program_id: null, title: "", text: "", price: null, date, cars: plan.tours.cars })]);

  const tours = picks.filter((p) => !p.free);
  const total = showPrice ? toursTotal(tours, tripCar, tourPrices, sarPer) : null;
  // met at the airport the group lands at for this city (a domestic flight in, else the international one);
  // seen off at the one it leaves from (a domestic flight out, else the flight home)
  const byDeparture = [...data.flights].sort((a, b) => (a.departure_at ?? "").localeCompare(b.departure_at ?? ""));
  const landsHere = byDeparture.filter((f) => f.leg_order !== "inbound" && f.to_city?.trim() === city.city_name).at(-1) ?? byDeparture.filter((f) => f.leg_order === "outbound").at(-1);
  const leavesHere = byDeparture.find((f) => f.leg_order !== "outbound" && f.from_city?.trim() === city.city_name) ?? byDeparture.find((f) => f.leg_order === "inbound");

  // the move in by air (the domestic leg into this city), and the car that takes the group to and from the airports
  const prev = index > 0 && data.cities[index - 1]?.city_name !== city.city_name ? data.cities[index - 1] : undefined;
  const hopLeg = prev ? legInto(data.flights, city.city_name, city.check_in, prev.city_name) : undefined;
  const clock = (iso: string | null | undefined) => {
    const t = (iso ?? "").slice(11, 16);
    return t && t !== "00:00" ? t : "";
  };
  const transferCar = transportOn && plan.airport.enabled ? vehicleText(plan.airport) : "";
  const transferRow = (date: string | null, text: string, time: string | false) => (
    <p className="tv-tnum flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[9px] bg-[#f4f9f7] px-2 py-1.5 text-[11.5px] font-bold text-[#0F4339]">
      <Plane className="size-3.5 text-[#185045]" />
      {date ? <span className="text-[#185045]">{dayLabel(date)}</span> : null}
      <DirText>{text}</DirText>
      {time ? <span className="text-[#557d78]">· {time}</span> : null}
      {transferCar ? <span className="text-[#557d78]">· {transferCar}</span> : null}
    </p>
  );

  // the airport legs, as rows of the same table: who meets the group, in what
  const airportRow = (leg: "airport" | "farewell", label: string, airport: string) => {
    const value = leg === "farewell" ? (plan.farewell ?? plan.airport) : plan.airport;
    return (
      <div className={`${rowGap} ${cols} rounded-[9px] bg-[#f4f9f7] p-1`}>
        <span className="col-span-2 inline-flex min-h-9 flex-wrap items-center gap-1.5 px-1 text-[12px] font-extrabold text-[#185045] xl:col-span-2">
          <UserRound className="size-3.5" />
          {label}
          <span className="font-bold text-[#557d78]">
            <DirText>{airport}</DirText>
          </span>
        </span>
        <select aria-label={tx("carType")} value={value.car_type} onChange={(e) => onCar(leg, { car_type: e.target.value })} className={basicField}>
          <CarOptions carTypes={carTypes} placeholder={tx("carType")} current={value.car_type} />
        </select>
        <CarCountSelect value={value.cars} onChange={(cars) => onCar(leg, { cars })} label={tx("cars")} className={basicField} />
      </div>
    );
  };
  const row = (pick: TourPick) => {
    const k = picks.indexOf(pick);
    return (
      <TourRow
        key={k}
        pick={pick}
        catalog={catalog}
        onChange={(slice) => setPick(k, slice)}
        onTripCar={(car) => onCar("tours", { car_type: car })}
        dates={dates}
        dayLabel={dayLabel}
        field={basicField}
        className={`${rowGap} ${cols}`}
      />
    );
  };

  return (
    <div className="space-y-1.5">
      {toursOn ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={tx("toursCount")} className="w-24">
            <select value={picks.length} onChange={(e) => onPicks(withTours(city, Number(e.target.value), plan.tours.cars, isLast))} className={`${basicField} px-1.5`}>
              {range(0, 15).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </Field>
          {/* the tours car, once for the whole trip */}
          <Field label={tx("tourCarAll")} className="w-52">
            <select value={tripCar} onChange={(e) => onCar("tours", { car_type: e.target.value })} className={basicField}>
              <CarOptions carTypes={carTypes} placeholder={tx("carType")} current={tripCar} />
            </select>
          </Field>
          <Field label={tx("cars")} className="w-16">
            <CarCountSelect
              value={plan.tours.cars}
              onChange={(cars) => {
                // a tour in the trip's count of cars keeps going in it
                if (picks.some((p) => tourCars(p) === plan.tours.cars)) {
                  onPicks(picks.map((p) => (tourCars(p) === plan.tours.cars ? { ...p, cars } : p)));
                }
                onCar("tours", { cars });
              }}
              label={tx("cars")}
              className={basicField}
            />
          </Field>
          <span className="tv-tnum mb-1.5 rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11.5px] font-bold text-[#185045]">
            {toursText(tx, tours.length, total)}
          </span>
        </div>
      ) : null}

      {/* the day the group arrives — the welcome (this file's words), or the move from the city before — then the car that meets it */}
      {isFirst ? (
        <DayLines label={tx("welcomeText")} date={city.check_in} lines={data.arrival_lines} fallback={arrivalLines(data)} onChange={(arrival_lines) => onSlice({ arrival_lines })} />
      ) : prev && hopMode(plan, prev.city_name, city.city_name) === "flight" ? (
        // by air: the transfer to the airport it leaves from, and the welcome at the one it lands at — each on its day
        <>
          {transferRow(
            localDatePart(hopLeg?.departure_at) ?? prev.check_out ?? city.check_in,
            tx("toAirport", { airport: hopLeg?.from_airport.trim() || `مطار ${prev.city_name}` }),
            clock(hopLeg?.departure_at) && tx("takeOffAt", { time: clock(hopLeg?.departure_at) }),
          )}
          {transferRow(
            localDatePart(hopLeg?.arrival_at) ?? city.check_in,
            tx("atAirport", { airport: hopLeg?.to_airport.trim() || `مطار ${city.city_name}` }),
            clock(hopLeg?.arrival_at) && tx("landsAt", { time: clock(hopLeg?.arrival_at) }),
          )}
        </>
      ) : city.check_in ? (
        <p className="tv-tnum text-[11.5px] font-bold text-[#0F4339]">
          ✓ {`${dayLabel(city.check_in)} — `}
          {tx("moveTo", { from: data.cities[index - 1]?.city_name ?? "", city: city.city_name })}
        </p>
      ) : null}
      {isFirst && transportOn ? airportRow("airport", tx("reception"), landsHere?.to_airport || "—") : null}

      {toursOn ? (
        <>
          <div className={`${head} ${cols} gap-2`}>
            <span>{t("pg.tour.date")}</span>
            <span>{t("pg.tour.service")}</span>
            <span>{t("pg.tour.car")}</span>
            <span>{t("pg.tour.cars")}</span>
            {showPrice ? (
              <>
                <span>{t("pg.tour.carPrice")}</span>
                <span>{t("pg.tour.total")}</span>
              </>
            ) : null}
          </div>
          {/* the city's days in order: each with its tours, or what the day is and a tour to add — on the last city the day home too */}
          {dates.map((date, d) => {
            const on = picks.filter((p) => p.date === date);
            if (on.length > 0) return <Fragment key={date}>{on.map(row)}</Fragment>;
            const title = data.days.find((x) => x.date === date && x.city_name === city.city_name)?.title;
            return (
              <div key={date} className="flex min-h-9 flex-wrap items-center gap-2 rounded-[8px] border border-dashed border-[#DCE9E5] px-2 py-1 text-[11.5px]">
                <span className="tv-tnum font-bold text-[#185045]">{dayLabel(date)}</span>
                {title ? <span className="min-w-0 truncate font-semibold text-[#7a948f]">{title}</span> : null}
                <button
                  type="button"
                  onClick={() => addOn(date)}
                  className="ms-auto inline-flex h-7 items-center gap-1 rounded-[7px] border border-dashed border-[#b7d0c7] px-2.5 font-bold text-[#185045] hover:bg-[#f0f7f4]"
                >
                  <Plus className="size-3.5" />
                  {d === 0 ? t("pg.itin.tourAfterArrival") : date === leaving ? t("pg.itin.tourBeforeDeparture") : t("pg.tour.add")}
                </button>
              </div>
            );
          })}
          {/* a city without dates yet: its tours, as they are */}
          {picks.filter((p) => !p.date || !dates.includes(p.date)).map(row)}
        </>
      ) : null}

      {isLast ? (
        <DayLines label={tx("farewellText")} date={leaving} lines={data.departure_lines} fallback={departureLines(data)} onChange={(departure_lines) => onSlice({ departure_lines })} />
      ) : null}
      {isLast && transportOn ? airportRow("farewell", tx("farewell"), leavesHere?.from_airport || "—") : null}
    </div>
  );
}

/**
 * The welcome / the farewell as this file says them, beside their date: the
 * company's words until the agent changes one, a line more if they want it, and
 * back to the default with one press (the key is then dropped — lines undefined).
 */
function DayLines({
  label,
  date,
  lines,
  fallback,
  onChange,
}: {
  label: string;
  date: string | null;
  lines: string[] | undefined;
  /** what the day says without lines of its own. */
  fallback: string[];
  onChange: (lines: string[] | undefined) => void;
}) {
  const tx = useBasicLabels();
  const shown = lines ?? fallback;
  return (
    <div className="space-y-1 rounded-[9px] border border-[#DCE9E5] bg-[#fbfdfc] p-2">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-[#0F4339]">
        <span>✓ {label}</span>
        {date ? <span className="tv-tnum text-[#557d78]">{dayLabel(date)}</span> : null}
        <span className="ms-auto flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => onChange([...shown, ""])}
            className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-dashed border-[#b7d0c7] px-2 text-[11px] text-[#185045] hover:bg-[#f0f7f4]"
          >
            <Plus className="size-3.5" />
            {tx("addLine")}
          </button>
          {lines ? (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[11px] text-[#557d78] hover:text-[#185045]"
            >
              <RotateCcw className="size-3.5" />
              {tx("defaultText")}
            </button>
          ) : null}
        </span>
      </div>
      {shown.map((line, k) => (
        <div key={k} className="flex items-center gap-1">
          <input aria-label={label} value={line} onChange={(e) => onChange(shown.map((l, j) => (j === k ? e.target.value : l)))} className={basicField} />
          {shown.length > 1 ? (
            <button type="button" aria-label={tx("removeLine")} onClick={() => onChange(shown.filter((_, j) => j !== k))} className="rounded-[7px] p-1 text-[#c43d3d] hover:bg-[#fff1f1]">
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The city's domestic flights — the one place they are entered: the airports
 * (from the cities, the package's own first), the day (the move's), and once
 * the tickets are in the flight number and the two clocks. A landing earlier
 * than the take-off is the next day («+1»): the city it lands in then starts a
 * day later and gives back the night spent flying (arrives_next_day).
 */
function DomesticPanel({
  legs,
  data,
  lookups,
  onSlice,
}: {
  legs: DraftData["flights"];
  data: DraftData;
  lookups: GeneratorLookups;
  onSlice: (slice: Partial<DraftData>) => void;
}) {
  const tx = useBasicLabels();
  const booking = data.flight_booking;
  const ranked = rankAirports(lookups.airports, tripCountries(data), data.cities.map((c) => c.city_name)).map((a) => ({
    value: airportDisplay(a),
    hint: a.city ?? a.country ?? undefined,
    keywords: [a.city, a.country, a.code].filter(Boolean).join(" "),
  }));
  const setLeg = (leg: DraftData["flights"][number], slice: Partial<DraftData["flights"][number]>) =>
    onSlice({ flights: data.flights.map((f) => (f === leg ? { ...f, ...slice } : f)) });
  const airport = (leg: DraftData["flights"][number], side: "from" | "to", value: string) => {
    const a = findAirport(value, lookups.airports);
    setLeg(leg, side === "from" ? { from_airport: value, from_tz: a?.timezone ?? null, from_city: a?.city ?? "" } : { to_airport: value, to_tz: a?.timezone ?? null, to_city: a?.city ?? "" });
  };
  // «MH1430» names its carrier: the first two letters are the airline's code
  const flightNo = (leg: DraftData["flights"][number], value: string) => {
    const no = value.toUpperCase().replace(/\s+/g, "");
    const carrier = lookups.airlines.find((a) => a.iata && no.startsWith(a.iata.toUpperCase()));
    setLeg(leg, { flight_no: no, ...(carrier ? { airline: carrier.name, airline_iata: carrier.iata } : {}) });
  };
  const day = (iso: string | null) => (iso ?? "").slice(0, 10);
  const time = (iso: string | null) => {
    const t = (iso ?? "").slice(11, 16);
    return t === "00:00" ? "" : t;
  };
  const cols = "xl:grid-cols-[minmax(11rem,1.4fr)_minmax(11rem,1.4fr)_9.5rem_7rem_6.5rem_8.5rem]";
  const addDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const nextDay = (leg: DraftData["flights"][number]) => Boolean(leg.arrival_at && leg.departure_at && day(leg.arrival_at) > day(leg.departure_at));
  // the stop the leg lands in — the one that starts a day later after a night in the air
  const stopOf = (leg: DraftData["flights"][number]) =>
    data.cities.findIndex((c, k) => k > 0 && c.city_name === leg.to_city?.trim() && data.cities[k - 1]?.city_name === leg.from_city?.trim());
  const setTimes = (leg: DraftData["flights"][number], dep: string, arr: string) => {
    const date = day(leg.departure_at) || data.trip.arrival_date || "";
    const next = Boolean(dep && arr && arr < dep);
    const flights = data.flights.map((f) =>
      f === leg ? { ...f, departure_at: `${date}T${dep || "00:00"}`, arrival_at: arr ? `${next ? addDay(date) : date}T${arr}` : null } : f,
    );
    const at = stopOf(leg);
    const city = data.cities[at];
    if (!city || Boolean(city.arrives_next_day) === next) return onSlice({ flights });
    // the night now spent flying comes off the city it lands in — and goes back when it no longer is
    const resized = setCityNights({ ...data, flights }, at, Math.max(city.nights + (next ? -1 : 1), 1));
    onSlice({ flights, hotels: resized.hotels, cities: resized.cities.map((c, k) => (k === at ? { ...c, arrives_next_day: next || undefined } : c)) });
  };

  return (
    <div className="space-y-1.5">
      {legs.length === 0 ? (
        <p className="text-[12px] font-semibold text-[#93aaa3]">{tx("noDomestic")}</p>
      ) : (
        <>
          <div className={`hidden gap-2 px-0.5 text-[10.5px] font-bold text-[#7a948f] xl:grid ${cols}`}>
            <span>{tx("domFrom")}</span>
            <span>{tx("domTo")}</span>
            <span>{tx("domDate")}</span>
            <span>{tx("domFlightNo")}</span>
            <span>{tx("domDep")}</span>
            <span>{tx("domArr")}</span>
          </div>
          {legs.map((leg, k) => (
            <div key={k} className={`grid grid-cols-2 items-center gap-2 ${cols}`}>
              <SuggestInput ariaLabel={tx("domFrom")} items={ranked} value={leg.from_airport} onChange={(v) => airport(leg, "from", v)} className={basicField} />
              <SuggestInput ariaLabel={tx("domTo")} items={ranked} value={leg.to_airport} onChange={(v) => airport(leg, "to", v)} className={basicField} />
              <input
                type="date"
                dir="ltr"
                aria-label={tx("domDate")}
                value={day(leg.departure_at)}
                onChange={(e) =>
                  setLeg(leg, {
                    departure_at: e.target.value ? `${e.target.value}T${time(leg.departure_at) || "00:00"}` : null,
                    arrival_at: leg.arrival_at && e.target.value ? `${nextDay(leg) ? addDay(e.target.value) : e.target.value}T${leg.arrival_at.slice(11, 16)}` : leg.arrival_at,
                    date_user_set: true,
                  })
                }
                className={`${basicField} tv-tnum px-2`}
              />
              <input dir="ltr" aria-label={tx("domFlightNo")} value={leg.flight_no} placeholder="MH1432" onChange={(e) => flightNo(leg, e.target.value)} className={`${basicField} tv-tnum text-center`} />
              <input
                type="time"
                dir="ltr"
                aria-label={tx("domDep")}
                value={time(leg.departure_at)}
                onChange={(e) => setTimes(leg, e.target.value, time(leg.arrival_at))}
                className={`${basicField} tv-tnum px-2`}
              />
              <span className="flex items-center gap-1">
                <input
                  type="time"
                  dir="ltr"
                  aria-label={tx("domArr")}
                  value={time(leg.arrival_at)}
                  onChange={(e) => setTimes(leg, time(leg.departure_at), e.target.value)}
                  className={`${basicField} tv-tnum px-2`}
                />
                {nextDay(leg) ? (
                  <span title={tx("nextDayHint", { city: leg.to_city ?? "" })} className="tv-tnum shrink-0 rounded-full bg-[#fff4dc] px-1.5 py-0.5 text-[10.5px] font-extrabold text-[#a86a10]">
                    {tx("nextDay")}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
          {/* the domestic booking's one price — the same field as in the flights step and the pricing card */}
          <label className="mt-1 inline-flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-[#185045]">
            {tx("domPrice")}
            <input
              type="number"
              min={0}
              dir="ltr"
              value={booking.dom_price ?? ""}
              placeholder="0"
              onChange={(e) =>
                onSlice({ flight_booking: { ...withTypedTotal(booking, "dom", typedNumber(e.target)), dom_currency: booking.dom_currency || "SAR" } })
              }
              className={`${basicField} tv-tnum w-32 text-center ${booking.dom_price == null ? "border-[#f0b4c2] bg-[#fff5f7]" : ""}`}
            />
            <span className="text-[#557d78]">{booking.dom_currency || "SAR"}</span>
          </label>
          <FlightFare booking={booking} kind="dom" trip={data.trip} field={basicField} onChange={(flight_booking) => onSlice({ flight_booking })} />
        </>
      )}
    </div>
  );
}
