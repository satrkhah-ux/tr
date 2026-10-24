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
  ChevronUp,
  GripVertical,
  ListChecks,
  Loader2,
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
  fromUnit,
  hotelCoverage,
  HOTEL_ROOM_NAME_MAX,
  hotelRoomName,
  perUnit,
  tourCars,
  withRooms,
  type CityService,
  type DraftData,
  type DraftHotel,
  type DraftRoomSpec,
  type GeneratorLookups,
  type LookupHotel,
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
  cityDates,
  cityServices,
  newServiceId,
  removeService,
  setService,
  withPicks,
  withTours,
  type BasicCity,
  type ServiceRow,
} from "@/lib/offer/basic";
import { arrivalLines, autoTourPicks, departureDay, departureLines, type TourProgram } from "@/lib/offer/itinerary";
import { BasicCityProgram } from "./BasicCityProgram";
import { DirText } from "@/components/DirText";
import { useRole } from "@/lib/roles/RoleContext";
import { usePartnerBrand } from "@/lib/partners/PartnerContext";
import { supplierStayRates, type SupplierStayRate, type SupplierStayRates } from "@/lib/data/hotel-search";
import { tourPriced, toursTotal, type TourPrice } from "@/lib/offer/pricing-suggest";
import type { BoardType } from "@/lib/types";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { suppliersFor } from "../generator/SupplierPrice";
import { countryInName, propertyAmong } from "@/lib/operations/supplier-request";
import { AddStayMenu, StayDatesLine } from "../generator/hotels/StayDates";
import { basicField, typedNumber } from "./styles";
import { HotelCombobox } from "./HotelCombobox";
import { RefundControl } from "../generator/hotels/RefundControl";
import { RoomTypePicker } from "../generator/hotels/RoomTypePicker";
import { nightsText, useBasicLabels } from "./labels";
import { CarCountSelect, CarOptions, ServiceKindSelect, TourRow, type TourCatalog } from "../tours/TourRow";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const DAY = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" });
/** «20 أكتوبر – 24 أكتوبر» */
const span = (c: { check_in: string | null; check_out: string | null }) =>
  c.check_in && c.check_out ? `${SHORT.format(new Date(`${c.check_in}T00:00:00Z`))} – ${SHORT.format(new Date(`${c.check_out}T00:00:00Z`))}` : "—";
/** «الأربعاء، 11 نوفمبر» */
const dayLabel = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

type Tab = "tours" | "program";

/**
 * The card's tables share one look: a row of small headings once, then rows of
 * bare fields aligned under them — rather than a label over every field, which
 * spread a city over half a screen. Below xl the rows wrap two to a line.
 */
const head = "hidden px-0.5 text-[10.5px] font-bold text-[#7a948f] xl:grid";
const rowGap = "grid grid-cols-2 items-start gap-2";
// the hotel, its room type, the board, the price (the owner, 2026-10-22) — the rest under «المزيد»
const HOTEL_COLS = "xl:grid-cols-[minmax(12rem,1.6fr)_5rem_minmax(10rem,1.4fr)_minmax(7.5rem,0.9fr)_minmax(7rem,0.8fr)_2rem]";
const chip = "inline-flex w-fit items-center rounded-full bg-[#eef6f3] px-2 py-0.5 text-[10.5px] font-bold text-[#185045]";
/** the services table: day · type · service · car · cars · price per car · total · remove */
const SVC_COLS = "xl:grid-cols-[minmax(9rem,1fr)_6.5rem_minmax(13rem,2fr)_minmax(8.5rem,1fr)_4.5rem_minmax(6.5rem,0.7fr)_minmax(6.5rem,0.7fr)_2.25rem]";
/** the same rows without the price per car and the total — for a viewer without pricing.view. */
const SVC_COLS_NO_PRICE = "xl:grid-cols-[minmax(9rem,1fr)_6.5rem_minmax(13rem,2fr)_minmax(8.5rem,1fr)_4.5rem_2.25rem]";

/** «عدد الجولات: 2 · الإجمالي: 800» — without a total (no pricing.view), the count alone. */
const toursText = (tx: ReturnType<typeof useBasicLabels>, n: number, total: number | null) =>
  total == null ? `${tx("toursCount")}: ${n}` : tx("toursSummary", { n, total: total.toLocaleString("en-US") });

/**
 * One city, in one of the page's two places for it (the owner, 2026-10-25: the hotels apart,
 * city by city, then the programme and the tours): `part` "hotels" is the city itself — its
 * order, its nights, another city in its place, its removal — with its stays, each hotel on
 * its dates; "programme" is its tours (with the airport reception / farewell beside them) and
 * its days, one tab open at a time.
 * Everything the trip already said (dates, meals, currency) is filled in for
 * the agent and kept under «معلومات إضافية».
 */
export function BasicCityCard({
  part,
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
  onFold,
  onGoHotel,
}: {
  part: "hotels" | "programme";
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
  /** «تصغير»: folds the card to its line, done or not (the line says what is missing) */
  onFold: () => void;
  /** the programme's hotel line, pressed: this city's card in «الفنادق», open — its hotel, nights, rooms */
  onGoHotel?: () => void;
}) {
  const tx = useBasicLabels();
  const hotelsPart = part === "hotels";
  // this stop's own stays — a city visited twice has two sets
  const lines = cityHotelLines(data.cities, data.hotels, index);
  const [main] = lines;
  // the visit's reception, farewell and transfers — on the tours tab, with the tours
  const services = transportOn && !hotelsPart ? cityServices(data, index) : [];
  // «البرنامج السياحي» opens once every tour of the city says what it is
  const picks = toursOn && !hotelsPart ? withTours(city, city.tours ?? 0, undefined, isLast) : [];
  const programLocked = picks.some((p) => !p.free && !p.title.trim());
  const tabs: { key: Tab; label: string; icon: typeof Plane; locked?: boolean }[] = hotelsPart
    ? []
    : [
        // the tours, and every car the group rides in on this visit
        ...(toursOn || services.length > 0
          ? [{ key: "tours" as const, label: toursOn ? tx("tours") : tx("transfersTab"), icon: toursOn ? Camera : UserRound }]
          : []),
        { key: "program" as const, label: tx("programTab"), icon: ListChecks, locked: programLocked },
      ];
  const [tab, setTab] = useState<Tab>("tours");
  const open = tabs.some((x) => x.key === tab && !x.locked) ? tab : tabs[0]?.key;

  // the city's nights against its stays: a night with no hotel, or one booked twice
  const cover = hotelsPart && hotelsOn ? hotelCoverage(data.cities, data.hotels)[index] : undefined;
  const short = cover ? cover.needed - (cover.covered - cover.extra) : 0;

  // what the city still lacks before «تمت»: its stays here; the tours and the airport cars in the programme
  const plan = data.transport_plan;
  const tripCar = plan.tours.car_type.trim();
  // the tours' prices, as the generator shows them: pricing.view only (a hidden price is kept, never cleared)
  const showPrice = useRole().can("pricing.view");
  const rooms = lines.flatMap((l) => l.rooms);
  const missing = (
    hotelsPart
      ? [
          hotelsOn && lines.some((l) => !l.hotel_name.trim()) && tx("hotel"),
          hotelsOn && rooms.some((r) => !(r.room_type_id || r.room_type_name.trim())) && tx("roomType"),
          hotelsOn && rooms.some((r) => !r.board_type) && tx("board"),
          hotelsOn && rooms.some((r) => r.price == null) && tx("price"),
        ]
      : [
          picks.some((p) => !p.free && !p.title.trim()) && tx("tourService"),
          picks.some((p) => !p.free && !(p.car_type?.trim() || tripCar)) && tx("carType"),
          // a tour the list prices is priced (the sheet takes the list's figure) — asked only of who sees the price
          showPrice && picks.some((p) => !tourPriced(p, tripCar, tourPrices)) && tx("tourPrice"),
          transportOn && isFirst && !plan.airport.car_type.trim() && tx("reception"),
          transportOn && isLast && !(plan.farewell ?? plan.airport).car_type.trim() && tx("farewell"),
        ]
  ).filter((x): x is string => Boolean(x));
  const stayPrice = rooms.reduce((sum, r) => sum + (r.price ?? 0), 0);
  const tours = picks.filter((p) => !p.free);
  const summary = (
    hotelsPart
      ? [
          [...new Set(lines.map((l) => l.hotel_name.trim()).filter(Boolean))].join(" + "),
          main && main.rooms.length > 0 ? `${main.rooms.length} × ${baseRoomName(main.rooms[0].room_type_name) || "—"}` : "",
          hotelsOn && stayPrice > 0 ? `${stayPrice.toLocaleString("en-US")} ${main?.manual_currency ?? ""}`.trim() : "",
        ]
      : [toursOn ? toursText(tx, tours.length, showPrice ? toursTotal(tours, tripCar, tourPrices, lookups.sarPer ?? { SAR: 1 }) : null) : ""]
  )
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

  // the part's own body — a city without hotels in the file has no stays to enter: its header is all of it
  const body = hotelsPart ? (
    hotelsOn && main ? (
      <HotelPanel index={index} city={city} dayFrom={dayFrom} data={data} lookups={lookups} lines={lines} onLines={onLines} onSlice={onSlice} onNights={onNights} />
    ) : null
  ) : open ? (
    <>
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
          onGoHotel={onGoHotel}
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
          onTours={() => setTab("tours")}
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
    </>
  ) : null;

  return (
    <article
      ref={card}
      id={`basic-${part}-${index}`}
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
        // an open card — the one being worked on — framed in the brand's green; a folded one stays quiet
        target ? "border-dashed border-[#2aa87a]" : moved ? "border-[#f1b5b5]" : !collapsed && body ? "border-[#2aa87a] ring-1 ring-[#2aa87a]/40" : "border-[#d8e6e0]"
      } ${over ? "border-t-4 border-t-[#2aa87a] shadow-[0_-6px_0_rgba(42,168,122,0.15)]" : ""} ${dragFrom === index ? "opacity-50" : ""}`}
    >
      {/* the city, its dates — and here its nights, order and removal, or there its tabs — one line */}
      <header className={`flex flex-wrap items-center gap-2 px-3 py-2 ${moved ? "bg-[#fdecec]" : "bg-[#eef5f2]"}`}>
        {hotelsPart ? (
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
        ) : null}
        {hotelsPart ? (
          // the arrows do what the drag does — on a phone, and from the keyboard — beside the handle, with the order
          <span className="inline-flex items-center">
            <button type="button" disabled={isFirst} onClick={() => onMove(index, index - 1)} aria-label={tx("moveUp")} title={tx("moveUp")} className="rounded-[7px] p-1 text-[#557d78] hover:bg-white disabled:opacity-30">
              <ArrowUp className="size-3.5" />
            </button>
            <button type="button" disabled={isLast} onClick={() => onMove(index, index + 1)} aria-label={tx("moveDown")} title={tx("moveDown")} className="rounded-[7px] p-1 text-[#557d78] hover:bg-white disabled:opacity-30">
              <ArrowDown className="size-3.5" />
            </button>
          </span>
        ) : null}
        <span className={`flex size-6 items-center justify-center rounded-full text-[11px] font-extrabold text-white ${moved ? "bg-[#c43d3d]" : "bg-[#185045]"}`}>{index + 1}</span>
        <h3 className="text-[13.5px] font-extrabold text-[#0f3d38]">{city.city_name}</h3>
        {city.country ? <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold text-[#557d78]">{city.country}</span> : null}
        {/* from a date to a date — the stays below are held inside them */}
        <span className="tv-tnum text-[11.5px] font-semibold text-[#557d78]">{span(city)}</span>
        {cover && cover.extra > 0 ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#b42318]">
            <AlertTriangle className="size-3.5" />
            {tx("nightsExtra", { n: cover.extra })}
          </span>
        ) : short > 0 ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#a86a10]">
            <AlertTriangle className="size-3.5" />
            {tx("nightsShort", { n: short })}
          </span>
        ) : null}
        {tabs.length > 1 && !collapsed ? (
          <div role="tablist" className="flex flex-wrap gap-1 sm:ms-auto">
            {tabs.map(({ key, label, icon: Icon, locked }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={open === key}
                disabled={locked}
                title={locked ? tx("programLocked") : undefined}
                onClick={() => setTab(key)}
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
        {/* the card's own controls, at its end: edit, delete, fold (the owner, 2026-10-24) — the nights are a field
            of the hotel row, never here beside the dates where they read as something else */}
        <div className={`flex items-center gap-1.5 ${tabs.length > 1 && !collapsed ? "" : "ms-auto"}`}>
          {hotelsPart ? (
            <>
            <button
              type="button"
              onClick={() => {
                setEditCountry(city.country || data.trip.country);
                setEditCity(city.city_name);
                setEditing((v) => !v);
              }}
              aria-expanded={editing}
              aria-label={tx("editCity")}
              title={tx("editCity")}
              className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#d3e2dc] bg-white px-2 text-[11px] font-bold text-[#185045] hover:border-[#165749]"
            >
              <Pencil className="size-3.5" />
              {tx("edit")}
            </button>
            {/* a city whose file has no hotels has no hotel row: its nights stay here */}
            {!hotelsOn || !main ? (
              <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#185045]">
                {tx("nights")}
                <select value={city.nights} onChange={(e) => onNights(Number(e.target.value))} className="h-7 rounded-[7px] border border-[#cfe0d9] bg-white px-1 text-[12px] font-bold">
                  {range(1, 30).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              onClick={onRemove}
              aria-label={tx("removeCity")}
              title={tx("removeCity")}
              className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#f2c7c7] bg-white px-2 text-[11px] font-bold text-[#c43d3d] hover:bg-[#fff1f1]"
            >
              <Trash2 className="size-3.5" />
              {tx("delete")}
            </button>
            </>
          ) : null}
          {body ? (
            <button
              type="button"
              onClick={collapsed ? onExpand : onFold}
              aria-expanded={!collapsed}
              className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#d3e2dc] bg-white px-2 text-[11px] font-bold text-[#557d78] hover:border-[#165749] hover:text-[#185045]"
            >
              {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
              {collapsed ? tx("expand") : tx("fold")}
            </button>
          ) : null}
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

      {!body ? null : collapsed ? (
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
      ) : (
        <div className="p-3">
          {body}
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
      )}
    </article>
  );
}

// ---------- the panels ----------

/** a city's stays — the hotel, rooms, board and price, each hotel on its dates; the hotels part of the card. */
export function HotelPanel({
  index,
  city,
  dayFrom,
  data,
  lookups,
  lines,
  onLines,
  onSlice,
  onNights,
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
  /** the city's nights — a field of the first hotel row (the owner, 2026-10-24) */
  onNights?: (nights: number) => void;
}) {
  const tx = useBasicLabels();
  const { t, language } = useTraveliunUI();
  const [more, setMore] = useState(false);
  const stays = deriveHotelStays(data.cities, data.hotels).filter((s) => s.city_index === index);
  const [main] = lines;
  // the same hotel, another room after some nights — it follows the first stay's hotel and rooms
  const change = roomChangeLine(lines);
  const mainNights = Math.max(stays[0]?.nights ?? city.nights, 1);
  const country = findLookupCountry(lookups.countries, city.country || data.trip.country);
  const listedHotels = country?.cities.find((c) => c.name === city.city_name)?.hotels ?? [];
  // staff only: where a room is bought is never a partner's to see
  const partner = usePartnerBrand() !== null;
  // hotels picked from TBO on this page: ours now, linked to their code — kept for the page (a remounted card keeps
  // them), and over the list read before the link existed
  const [, redraw] = useState(0);
  const pickedHere = [...tboPicked.values()].filter((p) => p.city === city.city_name);
  const hotels = [
    ...listedHotels.map((h) => {
      const p = pickedHere.find((x) => x.hotel.id === h.id)?.hotel;
      return p ? { ...h, ...p, name_en: p.name_en ?? h.name_en } : h;
    }),
    ...pickedHere.filter((p) => !listedHotels.some((h) => h.id === p.hotel.id)).map((p) => p.hotel),
  ];
  const tboOf = (id: string | null) => (id && !partner ? (hotels.find((h) => h.id === id)?.tbo ?? null) : null);
  const [tboFailed, setTboFailed] = useState(false);
  const canInternal = useRole().can("pricing.internal");
  // the currency: the destination's, the riyal and the dollar — every other behind «أخرى…»
  const [allCurrencies, setAllCurrencies] = useState(false);
  const shortCurrencies = [...new Set([country?.default_currency, "SAR", "USD", main.manual_currency].map((c) => c?.trim().toUpperCase()).filter((c): c is string => Boolean(c)))];
  // the suppliers who sell rooms here: not one whose name puts it in another country — a villa in Bali is not Istanbul's supplier
  const placeOf = (name: string) =>
    countryInName(
      name,
      lookups.countries.map((c) => c.name),
      lookups.countries.flatMap((c) => c.cities.map((ci) => ({ name: ci.name, country: c.name }))),
    );
  // a supplier that is itself a hotel, only in that hotel's city
  const hotelSuppliers = suppliersFor(lookups, "فنادق").filter(
    (s) => s.name === main.supplier || (propertyAmong(s, hotels.map((h) => h.name)) ?? (!country || [null, country.name].includes(placeOf(s.name)))),
  );

  /** The same answer for every stay of this city — the currency, the supplier. */
  const allLines = (fn: (line: DraftHotel) => DraftHotel) => onLines(lines.map(fn));
  /** A change to the first stay reaches its room change too; any other stay is its own. */
  const follow = (line: DraftHotel, fn: (line: DraftHotel) => DraftHotel) =>
    onLines(line.id === main.id && change ? [fn(line), fn(change)] : [fn(line)]);
  const setRoom = (line: DraftHotel, j: number, slice: Partial<DraftRoomSpec>) =>
    withRooms({ ...line, sourcing: null }, line.rooms.map((r, k) => (k === j ? { ...r, ...slice } : r)));

  // the room's NIGHT is typed; the stay's total is what is kept (stayUnits) — and the nights it is for
  const priceField = (value: number | null, nights: number, currency: string, onValue: (v: number | null) => void) => (
    <span className="grid gap-0.5">
      <input
        type="number"
        min={0}
        dir="ltr"
        aria-label={tx("nightPrice")}
        title={tx("nightPrice")}
        value={perUnit(value, nights) ?? ""}
        placeholder={tx("price")}
        onChange={(e) => onValue(fromUnit(typedNumber(e.target), nights))}
        className={`${basicField} tv-tnum text-center`}
      />
      {value != null ? (
        <span className="tv-tnum text-[10px] font-bold text-[#0f7a52]">
          {tx("nightsTimes", { n: nightsText(nights, language), total: `${value.toLocaleString("en-US")} ${currency}` })}
        </span>
      ) : null}
    </span>
  );

  return (
    <div className="space-y-1.5">
      <div className={`${head} ${HOTEL_COLS} gap-2`}>
        <span>{tx("hotel")}</span>
        <span>{tx("nights")}</span>
        <span>{tx("roomType")}</span>
        <span>{tx("board")}</span>
        <span>{tx("nightPrice")}</span>
        <span />
      </div>

      {/* every stay of the city: its hotel on the first room's row, each further room under it */}
      {lines.map((line, i) => {
        const stay = stays[i];
        const nights = Math.max(stay?.nights ?? city.nights, 1);
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
                      supplier={country && !partner ? { country: country.name, city: city.city_name } : null}
                      tboLabel={tx("tboChip")}
                      onFailed={() => setTboFailed(true)}
                      onPick={(h) => {
                        setTboFailed(false);
                        if (h?.tbo) {
                          tboPicked.set(h.id, { city: city.city_name, hotel: { id: h.id, name: h.name, name_en: h.name_en ?? null, stars: h.stars ?? null, tbo: h.tbo } });
                          redraw((n) => n + 1);
                        }
                        follow(line, (l) =>
                          withRooms(
                            { ...l, hotel_id: h?.id ?? null, hotel_name: h?.name ?? "", hotel_name_en: "", sourcing: null },
                            // a room type belongs to its hotel: the old hotel's id — and its own name for the room — must not follow
                            l.rooms.map((room) => ({ ...room, room_type_id: null, hotel_room_name: h?.id === l.hotel_id ? room.hotel_room_name : undefined })),
                          ),
                        );
                      }}
                      className="col-span-2 xl:col-span-1"
                    />
                  ) : (
                    <span className="col-span-2 inline-flex h-9 items-center text-[11.5px] font-extrabold text-[#185045] xl:col-span-1 xl:justify-end xl:pe-2">
                      {tx("roomN", { n: j + 1 })}
                    </span>
                  )}
                  {/* the city's nights: on its first row; the other stays say their own on their dates line */}
                  {i === 0 && j === 0 && onNights ? (
                    <label className="grid gap-0.5">
                      <span className="text-[10.5px] font-bold text-[#7a948f] xl:hidden">{tx("nights")}</span>
                      <select
                        value={city.nights}
                        onChange={(e) => onNights(Number(e.target.value))}
                        aria-label={tx("nights")}
                        className={`${basicField} tv-tnum text-center`}
                      >
                        {range(1, 30).map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="max-xl:hidden" />
                  )}
                  {/* the owner's catalogue: type, category, suite type — the extra bed rides on the name as before */}
                  <span className="grid gap-1">
                    <RoomTypePicker
                      room={{ ...r, room_type_name: baseRoomName(r.room_type_name) }}
                      onPick={(slice) =>
                        onLines([setRoom(line, j, { ...slice, room_type_name: slice.room_type_name && extra ? slice.room_type_name + EXTRA_BED : slice.room_type_name })])
                      }
                      selectClass={basicField}
                      extras={more}
                    />
                    {/* the hotel's own name for the room (hotels name theirs differently): under «المزيد», said here once given */}
                    {more ? (
                      <input
                        type="text"
                        value={r.hotel_room_name ?? ""}
                        maxLength={HOTEL_ROOM_NAME_MAX}
                        // not setRoom: a name is no reason to drop a supplier's rate
                        onChange={(e) => onLines([withRooms(line, line.rooms.map((x, k) => (k === j ? { ...x, hotel_room_name: e.target.value } : x)))])}
                        placeholder={tx("hotelRoomName")}
                        aria-label={tx("hotelRoomName")}
                        dir="auto"
                        className={basicField}
                      />
                    ) : hotelRoomName(r) ? (
                      <span dir="auto" className={`${chip} max-w-full break-words`}>{hotelRoomName(r)}</span>
                    ) : null}
                    {/* the extra bed: under «المزيد», and said here once it is on */}
                    {more ? (
                      <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] bg-white px-2 text-[11.5px] font-bold text-[#185045]">
                        <input
                          type="checkbox"
                          checked={extra}
                          onChange={(e) => onLines([setRoom(line, j, { room_type_name: baseRoomName(r.room_type_name) + (e.target.checked ? EXTRA_BED : "") })])}
                          className="size-3.5 accent-[#185045]"
                        />
                        {tx("extraBed")}
                      </label>
                    ) : extra ? (
                      <span className={chip}>{tx("extraBed")}</span>
                    ) : null}
                  </span>
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
                  {priceField(r.price, nights, line.manual_currency, (price) => onLines([{ ...setRoom(line, j, { price }), priced_nights: nights }]))}
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
            {!line.sourcing && more ? (
              <div className={`${rowGap} ${HOTEL_COLS}`}>
                <span className="max-xl:hidden xl:col-span-3" />
                <div className="col-span-2">
                  <RefundControl
                    refundable={line.refundable}
                    until={line.refundable_until}
                    onChange={(v) => follow(line, (l) => ({ ...l, ...v }))}
                    labels={{ yes: tx("refundable"), no: tx("nonRefundable"), until: tx("refundUntil") }}
                  />
                </div>
              </div>
            ) : !line.sourcing && line.refundable != null ? (
              // under «المزيد», and said once it is set
              <span className={chip}>
                {line.refundable ? tx("refundable") : tx("nonRefundable")}
                {line.refundable && line.refundable_until ? ` · ${line.refundable_until}` : ""}
              </span>
            ) : null}
            {tboOf(line.hotel_id) ? (
              <TboStayPrice
                // a new hotel, other dates, rooms or party: the last answer is not this stay's
                key={`${line.hotel_id}|${stay?.check_in}|${stay?.check_out}|${line.rooms.length}|${data.trip.adults}|${data.trip.children}|${(data.trip.children_ages ?? []).join(",")}|${line.manual_currency}`}
                line={line}
                country={country?.name ?? data.trip.country}
                checkIn={stay?.check_in ?? null}
                checkOut={stay?.check_out ?? null}
                nights={nights}
                trip={data.trip}
                canPrice={canInternal}
                onApply={(next) => onLines([next])}
              />
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

      {tboFailed ? <p className="text-[11.5px] font-bold text-[#c22850]">{tx("tboPickFailed")}</p> : null}
      <div className="flex flex-wrap items-center gap-3 border-t border-dashed border-[#DCE9E5] pt-2">
        <AddStayMenu
          label={tx("addHotel")}
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
        {!more && (main.supplier || main.manual_currency !== (country?.default_currency || main.manual_currency)) ? (
          <span className="flex flex-wrap gap-1">
            {main.supplier ? <span className={chip}>{main.supplier}</span> : null}
            <span className={chip}>{main.manual_currency}</span>
          </span>
        ) : null}
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
            <select
              value={main.manual_currency}
              onChange={(e) => (e.target.value === "__all" ? setAllCurrencies(true) : allLines((line) => ({ ...line, manual_currency: e.target.value })))}
              className={basicField}
            >
              {(allCurrencies ? currencyOptions(lookups.countries, main.manual_currency) : shortCurrencies).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              {allCurrencies ? null : <option value="__all">{tx("otherCurrency")}</option>}
            </select>
          </Field>
          {/* who the room was bought from — internal, never on the client document */}
          <Field label={t("pg.supplierLabel")} className="w-48">
            <select value={main.supplier ?? ""} onChange={(e) => allLines((line) => ({ ...line, supplier: e.target.value }))} className={basicField}>
              <option value="">{tx("choose")}</option>
              {hotelSuppliers.map((s) => (
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

/** TBO hotels picked on this page, by our hotel id — the page's life, so a remounted card keeps them. */
const tboPicked = new Map<string, { city: string; hotel: LookupHotel }>();

/**
 * A stay at a hotel picked from TBO: the price stays the one typed (TBO's rooms are not needed to sell it), and
 * «السعر من TBO» asks TBO for this stay's real price — the stay's dates, rooms and party — to put in its place
 * (the owner, 2026-10-24). A supplier's cost: pricing.internal only.
 */
function TboStayPrice({
  line,
  country,
  checkIn,
  checkOut,
  nights,
  trip,
  canPrice,
  onApply,
}: {
  line: DraftHotel;
  country: string;
  checkIn: string | null;
  checkOut: string | null;
  nights: number;
  trip: DraftData["trip"];
  canPrice: boolean;
  onApply: (line: DraftHotel) => void;
}) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const [state, setState] = useState<SupplierStayRates | "loading" | null>(null);
  const ask = () => {
    if (!line.hotel_id) return;
    setState("loading");
    void supplierStayRates({
      hotelId: line.hotel_id,
      countryName: country,
      checkIn: checkIn ?? "",
      checkOut: checkOut ?? "",
      rooms: Math.max(line.rooms.length, 1),
      adults: trip.adults,
      children: trip.children,
      childrenAges: trip.children_ages ?? [],
      currency: line.manual_currency,
    })
      .then(setState)
      .catch(() => setState({ ok: false, why: "unreachable" }));
  };
  const apply = (rate: SupplierStayRate) => {
    if (rate.total_line == null) return;
    const each = Math.round((rate.total_line / Math.max(line.rooms.length, 1)) * 100) / 100;
    onApply({
      ...withRooms(
        { ...line, sourcing: null, supplier: "TBO Holidays", refundable: rate.refundable, refundable_until: null },
        // each room its own name, as TBO gives them in order
        line.rooms.map((r, j) => ({ ...r, price: each, board_type: rate.board, hotel_room_name: (rate.rooms[j] ?? rate.rooms[0] ?? rate.room).slice(0, HOTEL_ROOM_NAME_MAX) })),
      ),
      priced_nights: nights,
    });
    setState(null);
  };
  return (
    <div className="grid gap-1.5 rounded-[9px] bg-[#f4f8ff] px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-[#2b5bb5]">
        <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-extrabold">{tx("tboChip")}</span>
        <span className="text-[#557d78]">{tx("tboTyped")}</span>
        {canPrice ? (
          <button
            type="button"
            onClick={ask}
            disabled={state === "loading" || !checkIn || !checkOut}
            className="ms-auto inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#2b5bb5] bg-white px-2.5 text-[11.5px] font-bold text-[#2b5bb5] hover:bg-[#eef4ff] disabled:opacity-50"
          >
            {state === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {tx("tboPrice")}
          </button>
        ) : null}
      </div>
      {state && state !== "loading" ? (
        state.ok ? (
          <ul className="grid gap-1">
            {state.rates.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-[7px] bg-white px-2 py-1.5 text-[11.5px]">
                <span dir="ltr" className="font-bold text-[#0f3d38]">{r.room}</span>
                <span className="text-[#557d78]">{t(BOARD_LABEL_KEYS[r.board])}</span>
                <span className={r.refundable ? "text-[#0f7a52]" : "text-[#c22850]"}>{r.refundable ? tx("refundable") : tx("nonRefundable")}</span>
                <span dir="ltr" className="tv-tnum ms-auto font-extrabold text-[#185045]">
                  {r.total.toLocaleString("en-US")} {r.currency}
                  {r.total_line != null && r.currency.toUpperCase() !== line.manual_currency.toUpperCase() ? ` ≈ ${r.total_line.toLocaleString("en-US")} ${line.manual_currency}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => apply(r)}
                  disabled={r.total_line == null}
                  className="rounded-[7px] bg-[#185045] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-50"
                >
                  {tx("tboUse")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11.5px] font-semibold text-[#7a5a12]">{tx(`tboWhy_${state.why}`)}</p>
        )
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
  onGoHotel,
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
  /** the hotel line pressed: the city's card in «الفنادق» */
  onGoHotel?: () => void;
}) {
  const tx = useBasicLabels();
  const { t, language } = useTraveliunUI();
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
  // the agent's edit makes a row the screen filled theirs (auto) — the count coming down then keeps it
  const setPick = (k: number, slice: Partial<TourPick>) => onPicks(picks.map((p, i) => (i === k ? onDay({ ...p, ...slice, auto: undefined }) : p)));
  // a tour added — by the count or on a day — arrives as the city's next programme, priced from the list
  const addOn = (date: string | null) => onPicks(autoTourPicks([...picks, onDay({ program_id: null, title: "", text: "", price: null, date, cars: plan.tours.cars })], programs));

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
          sarPer={sarPer}
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
          compact
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
      {/* first, where the group sleeps on this visit and for how many nights — clear and dark; pressed, it takes the
          agent to the city's own hotel card to change the hotel, its nights or rooms (the owner, 2026-10-24) */}
      {hotels.length > 0 ? (
        <button
          type="button"
          onClick={onGoHotel}
          disabled={!onGoHotel}
          title={tx("goHotel")}
          className="group flex w-full flex-wrap items-center gap-2 rounded-[10px] border border-[#cfe0d9] bg-[#f4f9f7] px-3 py-2 text-start text-[13.5px] font-extrabold text-[#0f3d38] transition-colors hover:border-[#185045] hover:bg-[#eaf4f0] disabled:cursor-default"
        >
          <BedDouble className="size-4 shrink-0 text-[#185045]" aria-hidden />
          <span>{tx("hotelIs", { hotel: hotels.join(" + ") })}</span>
          <span className="tv-tnum rounded-full bg-[#185045] px-2.5 py-0.5 text-[11.5px] font-bold text-white">{nightsText(city.nights, language)}</span>
          {onGoHotel ? (
            <span className="ms-auto inline-flex items-center gap-1 text-[11.5px] font-bold text-[#557d78] group-hover:text-[#185045]">
              <Pencil className="size-3.5" aria-hidden />
              {tx("goHotel")}
            </span>
          ) : null}
        </button>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        {toursOn ? (
          <>
            <Field label={tx("toursCount")} className="w-24">
              <select value={picks.length} onChange={(e) => onPicks(autoTourPicks(withTours(city, Number(e.target.value), plan.tours.cars, isLast), programs))} className={`${basicField} px-1.5`}>
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
  sarPer,
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
  /** riyals per unit of a currency — the list's dollars shown in the file's riyals */
  sarPer: Record<string, number>;
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
  // one car's figure in riyals, the file's currency: 80 USD in the list is 300 here (the owner's review, 2026-10-18)
  const rate = unit ? (unit.currency === "SAR" ? 1 : (sarPer[unit.currency] ?? 0)) : 0;
  const inSar = unit && rate ? Math.round(unit.price * rate * 100) / 100 : null;
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
            // the list's figure, in riyals, stands in the field until one is typed — not a grey hint mistaken for empty
            value={row.price ?? (fromSheet && inSar != null ? inSar : "")}
            placeholder="0"
            onChange={(e) => onPrice(typedNumber(e.target))}
            className={`${basicField} tv-tnum text-center`}
          />
          {fromSheet ? (
            <span className="tv-tnum text-[10px] font-bold text-[#0f7a52]">
              {tx("fromSheet")}
              {unit.currency !== "SAR" ? <DirText>{`: ${unit.price} ${unit.currency}`}</DirText> : null}
            </span>
          ) : null}
        </span>
      ) : null}
      {showPrice ? (
        <output className="tv-tnum inline-flex h-9 items-center justify-center rounded-[8px] bg-[#eef4f1] px-2 text-[12.5px] font-extrabold text-[#185045]">
          {inSar != null ? `${(inSar * row.cars).toLocaleString("en-US")} SAR` : unit ? `${(unit.price * row.cars).toLocaleString("en-US")} ${unit.currency}` : "—"}
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
