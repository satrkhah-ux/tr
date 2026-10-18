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
import {
  addStay,
  BOARD_LABEL_KEYS,
  BOARD_TYPES,
  cityHotelLines,
  currencyOptions,
  FREE_DAY_TITLE,
  vehicleText,
  deriveHotelStays,
  emptyRoomSpec,
  findLookupCountry,
  tourCars,
  withRooms,
  type CityService,
  type DraftData,
  type DraftHotel,
  type DraftRoomSpec,
  type GeneratorLookups,
  type ServiceKind,
  type TourPick,
  type TransportLeg,
} from "@/lib/offer/draft-types";
import {
  baseRoomName,
  changeRoom,
  clearRoomChange,
  EXTRA_BED,
  roomChangeLine,
  addService,
  airportDisplay,
  cityDates,
  cityServices,
  findAirport,
  newServiceId,
  rankAirports,
  removeService,
  setCityNights,
  setService,
  tripCountries,
  withPicks,
  withTours,
  type BasicCity,
  type ServiceRow,
} from "@/lib/offer/basic";
import { arrivalLines, departureDay, departureLines, type TourProgram } from "@/lib/offer/itinerary";
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
import { RoomTypePicker } from "../generator/hotels/RoomTypePicker";
import { nightsText, useBasicLabels } from "./labels";
import { CarCountSelect, CarOptions, ServiceKindSelect, TourRow, type TourCatalog } from "../tours/TourRow";

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
/** the services table: day · type · service · car · cars · price per car · total · remove */
const SVC_COLS = "xl:grid-cols-[minmax(9rem,1fr)_6.5rem_minmax(13rem,2fr)_minmax(8.5rem,1fr)_4.5rem_minmax(6.5rem,0.7fr)_minmax(6.5rem,0.7fr)_2.25rem]";
/** the same rows without the price per car and the total — for a viewer without pricing.view. */
const SVC_COLS_NO_PRICE = "xl:grid-cols-[minmax(9rem,1fr)_6.5rem_minmax(13rem,2fr)_minmax(8.5rem,1fr)_4.5rem_2.25rem]";

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
/** a stop's stays are complete: a hotel, and every room typed, with its board and price */
export const stayDone = (ls: DraftHotel[]) =>
  ls.length > 0 && ls.every((l) => l.hotel_name.trim() && l.rooms.length > 0 && l.rooms.every((r) => (r.room_type_id || r.room_type_name.trim()) && r.board_type && r.price != null));

export function BasicCityCard({
  index,
  city,
  dayFrom,
  data,
  lookups,
  programs,
  tourPrices,
  listPrices = {},
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
  /** each transfer's price in the company's list (by pricing ref) — shown before the pricing sheet is worked out. */
  listPrices?: Record<string, { price: number; currency: string }>;
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
  const touches = (c: { city_name: string }) => (f: DraftData["flights"][number]) =>
    f.leg_order === "internal" && (f.to_city?.trim() === c.city_name || f.from_city?.trim() === c.city_name);
  const domestic = data.flights.filter(touches(city));
  // the domestic booking is ONE price for every leg: asked once, on the first city a leg touches
  const domesticHome = data.cities.findIndex((c) => data.flights.some(touches(c)));
  // the visit's reception, farewell and transfers — on the tours tab, with the tours
  const services = transportOn ? cityServices(data, index) : [];
  // «البرنامج السياحي» opens once every tour of the city says what it is
  const picks = toursOn ? withTours(city, city.tours ?? 0, undefined, isLast) : [];
  const programLocked = picks.some((p) => !p.free && !p.title.trim());
  const tabs: { key: Tab; label: string; icon: typeof Plane; locked?: boolean }[] = [
    ...(hotelsOn && main ? [{ key: "hotel" as const, label: tx("hotel"), icon: BedDouble }] : []),
    // the tours, and every car the group rides in on this visit
    ...(toursOn || services.length > 0
      ? [{ key: "tours" as const, label: toursOn ? tx("tours") : tx("transfersTab"), icon: toursOn ? Camera : UserRound }]
      : []),
    ...(domestic.length > 0 || (data.scope.flights_domestic && index > 0) ? [{ key: "domestic" as const, label: tx("domesticTab"), icon: Plane }] : []),
    { key: "program" as const, label: tx("programTab"), icon: ListChecks, locked: programLocked },
  ];
  // a stay already complete (picked from the add bar, or a file reopened) is not asked again: the card opens on what is left
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
    data.scope.flights_domestic && index === domesticHome && !((data.flight_booking.dom_price ?? 0) > 0) && tx("domPrice"),
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
            <ServicesPanel
              index={index}
              city={city}
              programs={programs}
              tourPrices={tourPrices}
              listPrices={listPrices}
              sarPer={lookups.sarPer ?? { SAR: 1 }}
              data={data}
              carTypes={lookups.carTypes}
              isLast={isLast}
              toursOn={toursOn}
              transportOn={transportOn}
              showPrice={showPrice}
              hotels={hotelsOn ? [...new Set(lines.map((l) => l.hotel_name.trim()).filter(Boolean))] : []}
              services={services}
              onPicks={onPicks}
              onCar={onCar}
              onSlice={onSlice}
            />
          ) : null}
          {open === "program" && isFirst ? (
            <div className="mb-2">
              <DayLines label={tx("welcomeText")} date={city.check_in} lines={data.arrival_lines} fallback={arrivalLines(data)} onChange={(arrival_lines) => onSlice({ arrival_lines })} />
            </div>
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
          {open === "program" && isLast ? (
            <div className="mt-2">
              <DayLines label={tx("farewellText")} date={departureDay(city)} lines={data.departure_lines} fallback={departureLines(data)} onChange={(departure_lines) => onSlice({ departure_lines })} />
            </div>
          ) : null}
          {open === "domestic" ? (
            <DomesticPanel legs={domestic} data={data} lookups={lookups} onSlice={onSlice} priceCity={index === domesticHome ? null : (data.cities[domesticHome]?.city_name ?? null)} />
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

/** a city's stays — the hotel, rooms, board and price; on the card and in «١. الفنادق» (BasicHotelsStep). */
export function HotelPanel({
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
                  {/* the owner's catalogue: type, category, suite type — the extra bed rides on the name as before */}
                  <RoomTypePicker
                    room={{ ...r, room_type_name: baseRoomName(r.room_type_name) }}
                    onPick={(slice) =>
                      onLines([setRoom(line, j, { ...slice, room_type_name: slice.room_type_name && extra ? slice.room_type_name + EXTRA_BED : slice.room_type_name })])
                    }
                    selectClass={basicField}
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
 * The visit's services, one table, day by day — the owner's way of writing a
 * programme: «20 الاستقبال من مطار كوالالمبور … 20 جولة … 21 يوم حر … 22
 * التوصيل من فندق سيلانجور إلى مطار كوالالمبور», each with its price.
 *
 * The trip writes the rows it already knows, once each: the reception on the
 * day the group lands (or the transfer from the city before), the farewell to
 * the airport on the day it flies on; the tours are the city's picks (TourRow,
 * shared with the generator), «جولة بعد الوصول» and «جولة قبل المغادرة»
 * included; a day with nothing is «يوم حر». «+ إضافة خدمة» adds a row of any
 * type on any day, and a row's type changes what it is.
 *
 * Every row has its car, its cars and its price per car. A transfer's price is
 * its line on the pricing sheet: typed here it is the sheet's (priceAtSource
 * writes a sheet edit back here); until then the sheet's own figure shows
 * through. The trip's reception and farewell ride in the trip's transfer car —
 * the one the programme names — and any other row may have its own. The price
 * columns show with pricing.view only.
 */
function ServicesPanel({
  index,
  city,
  programs,
  tourPrices,
  listPrices,
  sarPer,
  data,
  carTypes,
  isLast,
  toursOn,
  transportOn,
  showPrice,
  hotels,
  services,
  onPicks,
  onCar,
  onSlice,
}: {
  index: number;
  city: BasicCity;
  programs: TourProgram[];
  tourPrices: TourPrice[];
  listPrices: Record<string, { price: number; currency: string }>;
  sarPer: Record<string, number>;
  data: DraftData;
  carTypes: GeneratorLookups["carTypes"];
  isLast: boolean;
  toursOn: boolean;
  transportOn: boolean;
  /** pricing.view: the price per car and the total. */
  showPrice: boolean;
  /** the hotels of this visit, by name. */
  hotels: string[];
  /** the visit's receptions, farewells and transfers (cityServices). */
  services: ServiceRow[];
  onPicks: (picks: TourPick[]) => void;
  onCar: (leg: "airport" | "farewell" | "tours", slice: Partial<TransportLeg>) => void;
  onSlice: (slice: Partial<DraftData>) => void;
}) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const plan = data.transport_plan;
  const tripCar = plan.tours.car_type;
  const cols = showPrice ? SVC_COLS : SVC_COLS_NO_PRICE;
  const nights = cityDates(city);
  const leaving = departureDay(city);
  // a tour goes on the city's nights — on the last city the day home too; a transfer on any day of the visit
  const tourDates = isLast && leaving ? [...nights, leaving] : nights;
  const visitDates = leaving ? [...nights, leaving] : nights;
  const picks = toursOn ? withTours(city, city.tours ?? 0, plan.tours.cars, isLast) : [];
  const catalog: TourCatalog = { city: city.city_name, programs, prices: tourPrices, sarPer, carTypes, tripCar, showPrice };
  const kinds: ServiceKind[] = [...(transportOn ? (["reception", "farewell", "transfer"] as const) : []), ...(toursOn ? (["tour"] as const) : [])];
  // a tour put on the day home is «قبل المغادرة»; moved off it, a tour of the city's nights
  const onDay = (p: TourPick): TourPick => ({ ...p, departure: isLast && leaving !== null && p.date === leaving ? true : undefined });
  const setPick = (k: number, slice: Partial<TourPick>) => onPicks(picks.map((p, i) => (i === k ? onDay({ ...p, ...slice }) : p)));
  const addOn = (date: string | null) => onPicks([...picks, onDay({ program_id: null, title: "", text: "", price: null, date, cars: plan.tours.cars })]);

  // ---- the transfers: what changed on a row is the row's own; the trip's reception and farewell are the trip's car ----
  const cities = data.cities;
  const setSvc = (s: ServiceRow, slice: Partial<Omit<CityService, "id">>) => onSlice({ cities: setService(cities, index, s.id, slice) });
  /**
   * A reception's price is the farewell's too — the same road the other way, the same car — while the
   * farewell has none of its own (the owner's review, 2026-10-18: 150 typed in, the way out left empty).
   */
  const setPrice = (s: ServiceRow, price: number | null) => {
    const back = s.id === "in" ? services.find((o) => o.id === "out" && o.price == null && (o.car_type ?? "") === (s.car_type ?? "")) : undefined;
    const next = setService(cities, index, s.id, { price });
    onSlice({ cities: back && price != null ? setService(next, index, back.id, { price }) : next });
  };
  const tripLeg = (s: ServiceRow): "airport" | "farewell" | null => (s.id === "in" && index === 0 ? "airport" : s.id === "out" && isLast ? "farewell" : null);
  const setCar = (s: ServiceRow, car: string) => {
    const leg = tripLeg(s);
    if (leg) return onCar(leg, { car_type: car });
    // no transfer car yet: the first chosen is the trip's
    if (!s.leg.car_type.trim()) return onCar(s.kind === "farewell" ? "farewell" : "airport", { car_type: car });
    setSvc(s, { car_type: car && car !== s.leg.car_type.trim() ? car : undefined });
  };
  const setCars = (s: ServiceRow, cars: number) => {
    const leg = tripLeg(s);
    if (leg) return onCar(leg, { cars });
    setSvc(s, { cars: cars !== s.leg.cars ? cars : undefined });
  };
  /** another type: the same row under another name — or, to and from «جولة», moved between the transfers and the tours with its day and cars */
  const setKind = (s: ServiceRow, kind: ServiceKind) => {
    if (kind !== "tour") return setSvc(s, { kind });
    const date = s.date && tourDates.includes(s.date) ? s.date : null;
    const car = s.car_type && s.car_type !== tripCar.trim() ? { car_type: s.car_type } : {};
    onSlice({ cities: withPicks(removeService(cities, index, s.id), index, [...picks, onDay({ program_id: null, title: "", text: "", price: null, date, cars: s.cars, ...car })]) });
  };
  const tourKind = (k: number, kind: ServiceKind) => {
    if (kind === "tour") return;
    const p = picks[k];
    const car = p.car_type?.trim() || tripCar.trim();
    const leg = kind === "farewell" ? (plan.farewell ?? plan.airport) : plan.airport;
    const rest = withPicks(cities, index, picks.filter((_, j) => j !== k));
    onSlice({ cities: setService(rest, index, newServiceId(), { kind, date: p.date ?? city.check_in, cars: tourCars(p), ...(car && car !== leg.car_type.trim() ? { car_type: car } : {}) }) });
  };

  // a transfer's figure: typed here, else the sheet's (one car's, in the line's currency)
  const unitOf = (s: ServiceRow): { price: number; currency: string } | null => {
    if (s.price != null) return { price: s.price, currency: "SAR" };
    const line = data.pricing.items.find((i) => i.item_type === "transport" && i.ref === s.ref);
    if (line?.sell_price != null) return { price: line.sell_price, currency: line.sell_currency || "SAR" };
    // not worked out on the sheet yet: the list's price for the road (the way back is the way there, reversed)
    return listPrices[s.ref] ?? null;
  };
  const tours = picks.filter((p) => !p.free);
  const total = showPrice
    ? toursTotal(tours, tripCar, tourPrices, sarPer) +
      services.reduce((sum, s) => {
        const u = unitOf(s);
        return sum + (u ? u.price * s.cars * (u.currency === "SAR" ? 1 : (sarPer[u.currency] ?? 0)) : 0);
      }, 0)
    : null;

  // ---- the rows, day by day: the way in first, then the tours and what was added, the way out last ----
  const lines: { date: string | null; rank: number; node: ReactNode }[] = [
    ...services.map((s) => ({
      date: s.date,
      rank: s.id === "in" ? 0 : s.id === "out" ? 4 : s.kind === "reception" ? 1 : s.kind === "farewell" ? 3 : 2,
      node: (
        <ServiceLine
          key={s.id}
          row={s}
          dates={visitDates}
          kinds={kinds}
          carTypes={carTypes}
          showPrice={showPrice}
          unit={unitOf(s)}
          className={`${rowGap} ${cols}`}
          onKind={(kind) => setKind(s, kind)}
          onDate={(date) => setSvc(s, { date })}
          onText={(text) => setSvc(s, { text: text === s.auto_text ? undefined : text })}
          onCar={(car) => setCar(s, car)}
          onCars={(cars) => setCars(s, cars)}
          onPrice={(price) => setPrice(s, price)}
          onRemove={() => onSlice({ cities: removeService(cities, index, s.id) })}
        />
      ),
    })),
    ...picks.map((pick, k) => ({
      date: pick.date ?? null,
      rank: 2,
      node: (
        <TourRow
          key={`tour-${k}`}
          pick={pick}
          catalog={catalog}
          onChange={(slice) => setPick(k, slice)}
          onTripCar={(car) => onCar("tours", { car_type: car })}
          dates={tourDates}
          dayLabel={dayLabel}
          field={basicField}
          className={`${rowGap} ${cols}`}
          kind={<ServiceKindSelect value="tour" kinds={kinds} onChange={(kind) => tourKind(k, kind)} className={basicField} />}
          onRemove={() => onPicks(picks.filter((_, j) => j !== k))}
        />
      ),
    })),
  ];
  // the visit's nights, and the day it leaves when something happens on it (on the last city a tour may)
  const shown = visitDates.filter((d) => nights.includes(d) || (isLast && toursOn && d === leaving) || lines.some((l) => l.date === d));
  const tourButton = (date: string, label: string) => (
    <button
      type="button"
      onClick={() => addOn(date)}
      className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-dashed border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
    >
      <Plus className="size-3.5" />
      {label}
    </button>
  );

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        {toursOn ? (
          <>
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
          </>
        ) : null}
        {/* the visit at a glance: the city, its dates, its tours and their car, what it all comes to */}
        <span className="tv-tnum mb-1.5 rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11.5px] font-bold text-[#185045]">
          {[
            city.city_name,
            span(city),
            toursOn ? `${tx("toursCount")}: ${tours.length}` : "",
            toursOn ? vehicleText(plan.tours) : "",
            total != null ? tx("totalIs", { total: Math.round(total).toLocaleString("en-US") }) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      {/* under it, where the group sleeps on this visit */}
      {hotels.length > 0 ? (
        <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#557d78]">
          <BedDouble className="size-3.5 text-[#185045]" />
          {tx("hotelIs", { hotel: hotels.join(" + ") })}
        </p>
      ) : null}

      <div className={`${head} ${cols} gap-2`}>
        <span>{t("pg.tour.date")}</span>
        <span>{t("pg.svc.kind")}</span>
        <span>{tx("tourService")}</span>
        <span>{t("pg.tour.car")}</span>
        <span>{t("pg.tour.cars")}</span>
        {showPrice ? (
          <>
            <span>{t("pg.tour.carPrice")}</span>
            <span>{t("pg.tour.total")}</span>
          </>
        ) : null}
        <span />
      </div>
      {shown.map((date) => {
        const on = lines.filter((l) => l.date === date).sort((a, b) => a.rank - b.rank);
        const first = date === nights[0];
        const home = isLast && date === leaving;
        // a tour may follow the reception, or go before the farewell home — once the day has none
        const extra =
          toursOn && !picks.some((p) => p.date === date) && (first || home)
            ? tourButton(date, first ? t("pg.itin.tourAfterArrival") : t("pg.itin.tourBeforeDeparture"))
            : null;
        if (on.length > 0) {
          return (
            <Fragment key={date}>
              {on.map((l) => l.node)}
              {extra ? <div className="flex justify-end">{extra}</div> : null}
            </Fragment>
          );
        }
        // nothing on the day: what it is — a free day, the arrival — and a tour to put on it
        const title = data.days.find((x) => x.date === date && x.city_name === city.city_name)?.title || (nights.includes(date) ? FREE_DAY_TITLE : "");
        return (
          <div key={date} className="flex min-h-9 flex-wrap items-center gap-2 rounded-[8px] border border-dashed border-[#DCE9E5] px-2 py-1 text-[11.5px]">
            <span className="tv-tnum font-bold text-[#185045]">{dayLabel(date)}</span>
            {title ? <span className="min-w-0 truncate font-semibold text-[#7a948f]">{title}</span> : null}
            {toursOn ? <span className="ms-auto">{extra ?? tourButton(date, t("pg.tour.add"))}</span> : null}
          </div>
        );
      })}
      {/* a city without dates yet: its rows, as they are */}
      {lines.filter((l) => !l.date || !shown.includes(l.date)).map((l) => l.node)}

      {kinds.length > 0 ? (
        <button
          type="button"
          onClick={() => (transportOn ? onSlice({ cities: addService(cities, index, "transfer", city.check_in) }) : addOn(null))}
          className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-dashed border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
        >
          <Plus className="size-3.5" />
          {tx("addService")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * One reception, farewell or transfer of the visit — the columns a tour's row
 * has: its day (the trip's for its own rows; an added one moves), its type, its
 * words (the trip's until the agent writes theirs), the car, how many, the price
 * per car and the total.
 */
function ServiceLine({
  row,
  dates,
  kinds,
  carTypes,
  showPrice,
  unit,
  className,
  onKind,
  onDate,
  onText,
  onCar,
  onCars,
  onPrice,
  onRemove,
}: {
  row: ServiceRow;
  dates: string[];
  kinds: ServiceKind[];
  carTypes: GeneratorLookups["carTypes"];
  showPrice: boolean;
  /** what one car costs — typed, or the sheet's. */
  unit: { price: number; currency: string } | null;
  className: string;
  onKind: (kind: ServiceKind) => void;
  onDate: (date: string) => void;
  onText: (text: string) => void;
  onCar: (car: string) => void;
  onCars: (cars: number) => void;
  onPrice: (price: number | null) => void;
  onRemove: () => void;
}) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const fromSheet = row.price == null && unit != null;
  return (
    <div className={`${className} rounded-[9px] bg-[#f4f9f7] p-1`}>
      {row.auto || !row.date ? (
        <span className="tv-tnum inline-flex min-h-9 items-center px-1 text-[12px] font-bold text-[#185045]">{row.date ? dayLabel(row.date) : "—"}</span>
      ) : (
        <select aria-label={t("pg.tour.date")} value={row.date} onChange={(e) => onDate(e.target.value)} className={basicField}>
          {(dates.includes(row.date) ? dates : [row.date, ...dates]).map((d) => (
            <option key={d} value={d}>{dayLabel(d)}</option>
          ))}
        </select>
      )}
      <ServiceKindSelect value={row.kind} kinds={kinds} onChange={onKind} className={basicField} />
      <span className="grid min-w-0 gap-0.5">
        <input
          aria-label={tx("tourService")}
          title={row.text || row.auto_text}
          value={row.text}
          // cleared, the trip's words show through
          placeholder={row.text ? undefined : row.auto_text}
          onChange={(e) => onText(e.target.value)}
          className={basicField}
        />
        {row.clock ? (
          <span className="tv-tnum flex items-center gap-1 text-[10px] font-bold text-[#557d78]">
            <Plane className="size-3" />
            {tx(row.kind === "farewell" ? "takeOffAt" : "landsAt", { time: row.clock })}
          </span>
        ) : null}
      </span>
      <select aria-label={t("pg.tour.car")} value={row.car_type} onChange={(e) => onCar(e.target.value)} className={basicField}>
        <CarOptions carTypes={carTypes} placeholder={t("pg.tour.car")} current={row.car_type} />
      </select>
      <CarCountSelect value={row.cars} onChange={onCars} label={t("pg.tour.cars")} className={basicField} />
      {showPrice ? (
        <span className="grid gap-0.5">
          <input
            type="number"
            min={0}
            dir="ltr"
            aria-label={t("pg.tour.carPrice")}
            value={row.price ?? ""}
            // the sheet's figure shows through until one is typed
            placeholder={fromSheet ? String(unit.price) : "0"}
            onChange={(e) => onPrice(typedNumber(e.target))}
            className={`${basicField} tv-tnum text-center`}
          />
          {fromSheet ? <span className="text-[10px] font-bold text-[#0f7a52]">{tx("fromSheet")}</span> : null}
        </span>
      ) : null}
      {showPrice ? (
        <output className="tv-tnum inline-flex h-9 items-center justify-center rounded-[8px] bg-[#eef4f1] px-2 text-[12.5px] font-extrabold text-[#185045]">
          {unit ? `${(unit.price * row.cars).toLocaleString("en-US")} ${unit.currency}` : "—"}
        </output>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        aria-label={tx("removeService")}
        title={tx("removeService")}
        className="inline-flex size-9 items-center justify-center self-start rounded-[8px] text-[#c43d3d] hover:bg-[#fff1f1]"
      >
        <X className="size-4" />
      </button>
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
  priceCity,
}: {
  legs: DraftData["flights"];
  data: DraftData;
  lookups: GeneratorLookups;
  onSlice: (slice: Partial<DraftData>) => void;
  /** null: the price is asked here; else the city whose card asks it. */
  priceCity: string | null;
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
          {/* the domestic booking's one price — asked once, naming every leg it pays for */}
          {priceCity ? (
            <p className="mt-1 text-[11.5px] font-bold text-[#557d78]">{tx("domPriceThere", { city: priceCity })}</p>
          ) : (
          <>
          <label className="mt-1 inline-flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-[#185045]">
            {tx("domPriceAll", { routes: data.flights.filter((f) => f.leg_order === "internal").map((f) => `${f.from_city || "—"} ← ${f.to_city || "—"}`).join("، ") })}
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
        </>
      )}
    </div>
  );
}
