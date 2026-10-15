"use client";

import { useState, type ReactNode } from "react";
import { BedDouble, Camera, CheckCircle2, ChevronDown, Pencil, Plane, Plus, Trash2, UserRound, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  BOARD_LABEL_KEYS,
  BOARD_TYPES,
  currencyOptions,
  deriveHotelStays,
  emptyRoomSpec,
  findLookupCountry,
  FREE_DAY_TITLE,
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
  cityLines,
  clearRoomChange,
  EXTRA_BED,
  renameRooms,
  airportDisplay,
  cityDates,
  findAirport,
  rankAirports,
  roomSuggestions,
  tripCountries,
  WELCOME,
  withTours,
  type BasicCity,
} from "@/lib/offer/basic";
import { programDayText, type TourProgram } from "@/lib/offer/itinerary";
import type { BoardType } from "@/lib/types";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { suppliersFor } from "../generator/SupplierPrice";
import { basicField, typedNumber } from "./styles";
import { HotelCombobox } from "./HotelCombobox";
import { nightsText, useBasicLabels } from "./labels";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const money = (n: number) => Math.round(n * 100) / 100;
const DAY = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
/** «الأربعاء، 11 نوفمبر» */
const dayLabel = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

type Tab = "hotel" | "tours" | "domestic";

/**
 * The card's tables share one look: a row of small headings once, then rows of
 * bare fields aligned under them — rather than a label over every field, which
 * spread a city over half a screen. Below xl the rows wrap two to a line.
 */
const head = "hidden px-0.5 text-[10.5px] font-bold text-[#7a948f] xl:grid";
const rowGap = "grid grid-cols-2 items-start gap-2";
const HOTEL_COLS = "xl:grid-cols-[minmax(12rem,1.6fr)_minmax(10rem,1.4fr)_minmax(7.5rem,0.9fr)_7rem_minmax(7rem,0.8fr)_2rem]";
const TOUR_COLS = "xl:grid-cols-[minmax(10rem,1fr)_minmax(14rem,2fr)_minmax(10rem,1.1fr)_minmax(7rem,0.7fr)]";

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
  onFlights,
  onRemove,
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
  tourPrices: { name: string; price: number; currency: string }[];
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
  /** open the flights step — the domestic legs are entered there. */
  onFlights: () => void;
  onRemove: () => void;
  /** «تمت» pressed: the card folds to its summary line. */
  collapsed: boolean;
  onDone: () => void;
  onExpand: () => void;
}) {
  const tx = useBasicLabels();
  const lines = cityLines(data.hotels, city.city_name);
  const [main, change] = lines;
  const domestic = data.flights.filter(
    (f) => f.leg_order === "internal" && (f.to_city?.trim() === city.city_name || f.from_city?.trim() === city.city_name),
  );
  const tabs: { key: Tab; label: string; icon: typeof Plane }[] = [
    ...(hotelsOn && main ? [{ key: "hotel" as const, label: tx("hotel"), icon: BedDouble }] : []),
    // the tours, and the reception / farewell cars beside them on the first and last city
    ...(toursOn || (transportOn && (isFirst || isLast))
      ? [{ key: "tours" as const, label: toursOn ? tx("tours") : tx("transfersTab"), icon: toursOn ? Camera : UserRound }]
      : []),
    ...(domestic.length > 0 || (data.scope.flights_domestic && index > 0) ? [{ key: "domestic" as const, label: tx("domesticTab"), icon: Plane }] : []),
  ];
  const [tab, setTab] = useState<Tab>("hotel");
  const open = tabs.some((x) => x.key === tab) ? tab : tabs[0]?.key;

  // what the city still lacks before «تمت»: the stay, the tours, the airport cars
  const plan = data.transport_plan;
  const picks = toursOn ? withTours(city, city.tours ?? 0) : [];
  const tripCar = plan.tours.car_type.trim();
  const rooms = lines.flatMap((l) => l.rooms);
  const missing = [
    hotelsOn && main && !main.hotel_name.trim() && tx("hotel"),
    hotelsOn && rooms.some((r) => !(r.room_type_id || r.room_type_name.trim())) && tx("roomType"),
    hotelsOn && rooms.some((r) => !r.board_type) && tx("board"),
    hotelsOn && rooms.some((r) => r.price == null) && tx("price"),
    picks.some((p) => !p.free && !p.title.trim()) && tx("tourService"),
    picks.some((p) => !p.free && !(p.car_type?.trim() || tripCar)) && tx("carType"),
    picks.some((p) => !p.free && p.price == null) && tx("tourPrice"),
    transportOn && isFirst && !plan.airport.car_type.trim() && tx("reception"),
    transportOn && isLast && !(plan.farewell ?? plan.airport).car_type.trim() && tx("farewell"),
  ].filter((x): x is string => Boolean(x));
  const stayPrice = rooms.reduce((sum, r) => sum + (r.price ?? 0), 0);
  const tours = picks.filter((p) => !p.free);
  const summary = [
    main?.hotel_name,
    main && main.rooms.length > 0 ? `${main.rooms.length} × ${baseRoomName(main.rooms[0].room_type_name) || "—"}` : "",
    hotelsOn && stayPrice > 0 ? `${stayPrice.toLocaleString("en-US")} ${main?.manual_currency ?? ""}`.trim() : "",
    toursOn ? tx("toursSummary", { n: tours.length, total: tours.reduce((s, p) => s + (p.price ?? 0), 0).toLocaleString("en-US") }) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article id={`basic-city-${index}`} className="scroll-mt-20 overflow-hidden rounded-[14px] border border-[#d8e6e0] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      {/* the city, its tabs and its nights — one line */}
      <header className="flex flex-wrap items-center gap-2 bg-[#eef5f2] px-3 py-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-[#185045] text-[11px] font-extrabold text-white">{index + 1}</span>
        <h3 className="text-[13.5px] font-extrabold text-[#0f3d38]">{city.city_name}</h3>
        {city.country ? <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold text-[#557d78]">{city.country}</span> : null}
        {hop}
        {tabs.length > 0 && !collapsed ? (
          <div role="tablist" className="flex flex-wrap gap-1 sm:ms-3">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={open === key}
                onClick={() => setTab(key)}
                className={`inline-flex h-7 items-center gap-1 rounded-[7px] border px-2.5 text-[11.5px] font-bold transition-colors ${
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

      {collapsed ? (
        // done: one line — what the city holds, and a press reopens it
        <button
          type="button"
          onClick={onExpand}
          className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-[#f7fbf9]"
        >
          <CheckCircle2 className={`size-4 shrink-0 ${missing.length > 0 ? "text-[#a86a10]" : "text-[#0f7a52]"}`} />
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
            <HotelPanel index={index} city={city} dayFrom={dayFrom} data={data} lookups={lookups} main={main} change={change} lines={lines} onLines={onLines} onSlice={onSlice} />
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
              onPicks={onPicks}
              onCar={onCar}
            />
          ) : null}
          {open === "domestic" ? (
            <DomesticPanel index={index} legs={domestic} data={data} lookups={lookups} onSlice={onSlice} onFlights={onFlights} />
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
  main,
  change,
  lines,
  onLines,
  onSlice,
}: {
  index: number;
  city: BasicCity;
  dayFrom: number;
  data: DraftData;
  lookups: GeneratorLookups;
  main: DraftHotel;
  change: DraftHotel | undefined;
  lines: DraftHotel[];
  onLines: (lines: DraftHotel[]) => void;
  onSlice: (slice: Partial<DraftData>) => void;
}) {
  const tx = useBasicLabels();
  const { t, language } = useTraveliunUI();
  const [more, setMore] = useState(false);
  const stays = deriveHotelStays(data.cities, data.hotels).filter((s) => s.city_name === city.city_name);
  const mainNights = Math.max(stays[0]?.nights ?? city.nights, 1);
  const changeNights = Math.max(stays[1]?.nights ?? 0, 1);
  const hotels =
    findLookupCountry(lookups.countries, city.country || data.trip.country)?.cities.find((c) => c.name === city.city_name)?.hotels ?? [];
  // the clear names first, then this hotel's own — never every hotel's
  const roomNames = roomSuggestions(lookups.roomTypes, main.hotel_id);
  // a hotel the list does not hold (an older file) still shows its name
  const outside = main.hotel_name && !hotels.some((h) => h.id === main.hotel_id) ? (main.hotel_id ?? "__current") : null;
  const priceTitle = tx("stayPrice", { n: nightsText(mainNights, language) });

  /** The same answer for every stay of this city — one hotel, the room changes inside it. */
  const allLines = (fn: (line: DraftHotel) => DraftHotel) => onLines(lines.map(fn));
  const setRoom = (line: DraftHotel, j: number, slice: Partial<DraftRoomSpec>) =>
    withRooms({ ...line, sourcing: null }, line.rooms.map((r, k) => (k === j ? { ...r, ...slice } : r)));
  const setAllRooms = (line: DraftHotel, slice: Partial<DraftRoomSpec>) =>
    withRooms({ ...line, sourcing: null }, line.rooms.map((r) => ({ ...r, ...slice })));

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
        <span>{priceTitle}</span>
        <span />
      </div>

      {/* the hotel on the first room's row; each further room under it, field for field */}
      {main.rooms.map((r, j) => {
        const extra = r.room_type_name.endsWith(EXTRA_BED);
        return (
          <div key={j} className={`${rowGap} ${HOTEL_COLS}`}>
            {j === 0 ? (
              <HotelCombobox
                hotels={hotels}
                valueId={main.hotel_id}
                currentName={outside ? main.hotel_name : null}
                placeholder={`${tx("hotel")} — ${tx("choose")}`}
                onPick={(h) => {
                  allLines((line) =>
                    withRooms(
                      { ...line, hotel_id: h?.id ?? null, hotel_name: h?.name ?? "", hotel_name_en: "", sourcing: null },
                      // a room type belongs to its hotel: the old hotel's id must not follow
                      line.rooms.map((room) => ({ ...room, room_type_id: null })),
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
            <input
              aria-label={tx("roomType")}
              placeholder={tx("roomType")}
              list={`basic-rooms-${index}`}
              value={baseRoomName(r.room_type_name)}
              onChange={(e) => onLines([setRoom(main, j, { room_type_id: null, room_type_name: e.target.value + (extra ? EXTRA_BED : "") })])}
              className={basicField}
            />
            <select
              aria-label={tx("board")}
              value={r.board_type ?? ""}
              onChange={(e) => onLines([setRoom(main, j, { board_type: (e.target.value || null) as BoardType | null })])}
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
                onChange={(e) => onLines([setRoom(main, j, { room_type_name: baseRoomName(r.room_type_name) + (e.target.checked ? EXTRA_BED : "") })])}
                className="size-3.5 accent-[#185045]"
              />
              {tx("extraBed")}
            </label>
            {priceField(r.price, mainNights, main.manual_currency, (price) => onLines([setRoom(main, j, { price })]), priceTitle)}
            {main.rooms.length > 1 ? (
              <button
                type="button"
                onClick={() => allLines((line) => withRooms(line, line.rooms.filter((_, k) => k !== j)))}
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
      <datalist id={`basic-rooms-${index}`}>
        {roomNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-center gap-3 pt-0.5">
        {/* a new room is a room of its own: its type and price are asked, the board follows */}
        <button
          type="button"
          // a new room starts as the one before it — type, board and price — and is changed if it differs
          onClick={() => allLines((line) => withRooms(line, [...line.rooms, { ...(line.rooms[line.rooms.length - 1] ?? emptyRoomSpec()) }]))}
          className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-dashed border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
        >
          <Plus className="size-3.5" />
          {tx("addRoom")}
        </button>
        {/* a stay we price ourselves: is it refundable? (a supplier rate states its own policy) */}
        {!main.sourcing ? (
          <span role="group" className="inline-flex overflow-hidden rounded-[7px] border border-[#cfe0d9] text-[11.5px] font-bold">
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={main.refundable === v}
                onClick={() => {
                  const next = main.refundable === v ? null : v;
                  allLines((line) => ({ ...line, refundable: next }));
                }}
                className={`h-7 px-2.5 transition-colors ${
                  main.refundable === v
                    ? v
                      ? "bg-[#e4f6ef] text-[#0f7a52]"
                      : "bg-[#fdeeee] text-[#c43d3d]"
                    : "bg-white text-[#557d78] hover:bg-[#f4f8f6]"
                }`}
              >
                {tx(v ? "refundable" : "nonRefundable")}
              </button>
            ))}
          </span>
        ) : null}
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
            {stays.map((s) => (s.check_in ? ` · ${tx("stayDates", { in: s.check_in, out: s.check_out ?? "" })}` : ""))}
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
          {city.nights > 1 ? (
            <Field label={tx("roomChange")} className="w-36">
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
            </Field>
          ) : null}
          {change ? (
            <>
              <Field label={tx("newRoom")} className="w-52">
                <input
                  list={`basic-rooms-${index}`}
                  value={baseRoomName(change.rooms[0]?.room_type_name ?? "")}
                  onChange={(e) => onLines([renameRooms(change, e.target.value)])}
                  className={basicField}
                />
              </Field>
              <Field label={tx("stayPrice", { n: nightsText(changeNights, language) })} className="w-36">
                {priceField(
                  change.rooms[0]?.price ?? null,
                  changeNights,
                  change.manual_currency,
                  (price) => onLines([setAllRooms(change, { price })]),
                  tx("stayPrice", { n: nightsText(changeNights, language) }),
                )}
              </Field>
            </>
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
 * The count is set here (any number — a client may want more tours than days);
 * each tour gets its day written down, the next one the city has free. The tours
 * car is chosen once for the whole trip; a tour given another car keeps its own.
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
  onPicks,
  onCar,
}: {
  index: number;
  city: BasicCity;
  programs: TourProgram[];
  tourPrices: { name: string; price: number; currency: string }[];
  sarPer: Record<string, number>;
  data: DraftData;
  carTypes: GeneratorLookups["carTypes"];
  isFirst: boolean;
  isLast: boolean;
  toursOn: boolean;
  transportOn: boolean;
  onPicks: (picks: TourPick[]) => void;
  onCar: (leg: "airport" | "farewell" | "tours", slice: Partial<TransportLeg>) => void;
}) {
  const tx = useBasicLabels();
  const plan = data.transport_plan;
  const tripCar = plan.tours.car_type;
  const offered = programs.filter((p) => !p.is_free_day).map((p) => ({ program: p, ...programDayText(p) }));
  // every night of the city may hold a tour; each tour shows the day it is on
  const dates = cityDates(city);
  const picks = withTours(city, city.tours ?? 0);
  const isFree = (title: string) => title.trim() === FREE_DAY_TITLE;

  /** What a typed service is: «يوم حر», one of the ready programmes, or a tour of the agent's own. */
  const serviceOf = (title: string): Pick<TourPick, "program_id" | "title" | "text" | "free"> => {
    if (isFree(title)) return { program_id: null, title: FREE_DAY_TITLE, text: "", free: true };
    const hit = offered.find((o) => o.title === title);
    return hit ? { program_id: hit.program.id, title: hit.title, text: hit.activities[0] ?? "", free: false } : { program_id: null, title, text: "", free: false };
  };
  const setPick = (k: number, slice: Partial<TourPick>) => onPicks(picks.map((p, i) => (i === k ? { ...p, ...slice } : p)));
  /** A tour on the company's price list, in riyals (the tours are priced in riyals). */
  const listedPrice = (title: string): number | null => {
    const key = title.trim();
    const hit = key ? tourPrices.find((t) => t.name === key) : undefined;
    if (!hit) return null;
    const rate = hit.currency === "SAR" ? 1 : sarPer[hit.currency];
    return rate ? Math.round(hit.price * rate) : null;
  };

  const tours = picks.filter((p) => !p.free);
  const total = tours.reduce((sum, p) => sum + (p.price ?? 0), 0);
  // met at the airport the group lands at for this city (a domestic flight in, else the international one);
  // seen off at the one it leaves from (a domestic flight out, else the flight home)
  const byDeparture = [...data.flights].sort((a, b) => (a.departure_at ?? "").localeCompare(b.departure_at ?? ""));
  const landsHere = byDeparture.filter((f) => f.leg_order !== "inbound" && f.to_city?.trim() === city.city_name).at(-1) ?? byDeparture.filter((f) => f.leg_order === "outbound").at(-1);
  const leavesHere = byDeparture.find((f) => f.leg_order !== "outbound" && f.from_city?.trim() === city.city_name) ?? byDeparture.find((f) => f.leg_order === "inbound");

  const carOptions = (placeholder: string) => (
    <>
      <option value="">{placeholder}</option>
      {carTypes.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
          {c.pax ? ` (${c.pax})` : ""}
        </option>
      ))}
    </>
  );
  const countSelect = (value: number, onValue: (n: number) => void, label: string) => (
    <select aria-label={label} value={value} onChange={(e) => onValue(Number(e.target.value))} className={`${basicField} px-1.5`}>
      {range(1, 10).map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
    </select>
  );
  // the airport legs, as rows of the same table: who meets the group, in what
  const airportRow = (leg: "airport" | "farewell", label: string, airport: string) => {
    const value = leg === "farewell" ? (plan.farewell ?? plan.airport) : plan.airport;
    return (
      <div className={`${rowGap} ${TOUR_COLS} rounded-[9px] bg-[#f4f9f7] p-1`}>
        <span className="col-span-2 inline-flex min-h-9 flex-wrap items-center gap-1.5 px-1 text-[12px] font-extrabold text-[#185045] xl:col-span-2">
          <UserRound className="size-3.5" />
          {label}
          <span className="font-bold text-[#557d78]">
            <DirText>{airport}</DirText>
          </span>
        </span>
        <select aria-label={tx("carType")} value={value.car_type} onChange={(e) => onCar(leg, { car_type: e.target.value })} className={basicField}>
          {carOptions(tx("carType"))}
        </select>
        {countSelect(value.cars, (cars) => onCar(leg, { cars }), tx("cars"))}
      </div>
    );
  };

  return (
    <div className="space-y-1.5">
      {toursOn ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={tx("toursCount")} className="w-24">
            <select value={picks.length} onChange={(e) => onPicks(withTours(city, Number(e.target.value)))} className={`${basicField} px-1.5`}>
              {range(0, 15).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </Field>
          {/* the tours car, once for the whole trip */}
          <Field label={tx("tourCarAll")} className="w-52">
            <select value={tripCar} onChange={(e) => onCar("tours", { car_type: e.target.value })} className={basicField}>
              {carOptions(tx("carType"))}
            </select>
          </Field>
          <Field label={tx("cars")} className="w-16">
            {countSelect(plan.tours.cars, (cars) => onCar("tours", { cars }), tx("cars"))}
          </Field>
          <span className="tv-tnum mb-1.5 rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11.5px] font-bold text-[#185045]">
            {tx("toursSummary", { n: tours.length, total: total.toLocaleString("en-US") })}
          </span>
        </div>
      ) : null}

      {/* the day the group arrives — the welcome, or the move from the city before — then the car that meets it */}
      {isFirst || city.check_in ? (
        <p className="tv-tnum text-[11.5px] font-bold text-[#0F4339]">
          ✓ {city.check_in ? `${dayLabel(city.check_in)} — ` : ""}
          {isFirst ? WELCOME : tx("moveTo", { from: data.cities[index - 1]?.city_name ?? "", city: city.city_name })}
        </p>
      ) : null}
      {isFirst && transportOn ? airportRow("airport", tx("reception"), landsHere?.to_airport || "—") : null}

      {toursOn && picks.length > 0 ? (
        <>
          <div className={`${head} ${TOUR_COLS} gap-2`}>
            <span>{tx("tourDate")}</span>
            <span>{tx("tourService")}</span>
            <span>{tx("carType")}</span>
            <span>{tx("tourPrice")}</span>
          </div>
          <datalist id={`basic-tours-${index}`}>
            <option value={FREE_DAY_TITLE} />
            {offered.map((o) => (
              <option key={o.program.id} value={o.title} />
            ))}
            {tourPrices.map((t) => (
              <option key={`p-${t.name}`} value={t.name} label={`${t.price} ${t.currency}`} />
            ))}
          </datalist>
          {picks.map((pick, k) => (
            <div key={k} className={`${rowGap} ${TOUR_COLS}`}>
              <select aria-label={tx("tourDate")} value={pick.date ?? ""} onChange={(e) => setPick(k, { date: e.target.value || null })} className={basicField}>
                {dates.map((d) => (
                  <option key={d} value={d}>{dayLabel(d)}</option>
                ))}
              </select>
              <input
                aria-label={tx("tourService")}
                list={`basic-tours-${index}`}
                value={pick.free ? FREE_DAY_TITLE : pick.title}
                placeholder={offered.length > 0 ? tx("tourPickHint") : `${FREE_DAY_TITLE} / جولة سياحية في ${city.city_name}`}
                onChange={(e) => {
                  const s = serviceOf(e.target.value);
                  // a tour from the price list arrives priced; a typed one keeps what was there
                  setPick(k, { ...s, price: s.free ? 0 : (listedPrice(e.target.value) ?? (pick.free ? null : pick.price)) });
                }}
                className={`${basicField} ${pick.free ? "text-[#7a948f]" : ""}`}
              />
              {/* the trip's tours car until this tour is given its own; the first car chosen becomes the trip's */}
              <select
                aria-label={tx("carType")}
                value={pick.car_type || tripCar}
                onChange={(e) => {
                  const car = e.target.value;
                  if (!tripCar) onCar("tours", { car_type: car });
                  else setPick(k, { car_type: car && car !== tripCar ? car : undefined });
                }}
                className={basicField}
              >
                {carOptions(tx("carType"))}
              </select>
              <input
                type="number"
                min={0}
                dir="ltr"
                aria-label={tx("tourPrice")}
                disabled={pick.free}
                value={pick.free ? 0 : (pick.price ?? "")}
                placeholder="0"
                onChange={(e) => setPick(k, { price: typedNumber(e.target) })}
                className={`${basicField} tv-tnum text-center disabled:bg-[#f4f7f6]`}
              />
            </div>
          ))}
        </>
      ) : null}

      {isLast && transportOn ? airportRow("farewell", tx("farewell"), leavesHere?.from_airport || "—") : null}
    </div>
  );
}

/**
 * The city's domestic flights, edited where the city is: the airports (the
 * package's own first), the day, and — once the tickets are in — the flight
 * number and the times. The legs come from the cities; nothing here has to be
 * typed for a planned flight but its price.
 */
function DomesticPanel({
  index,
  legs,
  data,
  lookups,
  onSlice,
  onFlights,
}: {
  index: number;
  legs: DraftData["flights"];
  data: DraftData;
  lookups: GeneratorLookups;
  onSlice: (slice: Partial<DraftData>) => void;
  onFlights: () => void;
}) {
  const tx = useBasicLabels();
  const booking = data.flight_booking;
  const listId = `basic-dom-airports-${index}`;
  const ranked = rankAirports(lookups.airports, tripCountries(data), data.cities.map((c) => c.city_name));
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
  const cols = "xl:grid-cols-[minmax(11rem,1.4fr)_minmax(11rem,1.4fr)_9.5rem_7rem_6.5rem_6.5rem]";

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
              <input aria-label={tx("domFrom")} list={listId} value={leg.from_airport} onChange={(e) => airport(leg, "from", e.target.value)} className={basicField} />
              <input aria-label={tx("domTo")} list={listId} value={leg.to_airport} onChange={(e) => airport(leg, "to", e.target.value)} className={basicField} />
              <input
                type="date"
                dir="ltr"
                aria-label={tx("domDate")}
                value={day(leg.departure_at)}
                onChange={(e) =>
                  setLeg(leg, {
                    departure_at: e.target.value ? `${e.target.value}T${time(leg.departure_at) || "00:00"}` : null,
                    arrival_at: leg.arrival_at && e.target.value ? `${e.target.value}T${leg.arrival_at.slice(11, 16)}` : leg.arrival_at,
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
                onChange={(e) => setLeg(leg, { departure_at: `${day(leg.departure_at) || (data.trip.arrival_date ?? "")}T${e.target.value || "00:00"}` })}
                className={`${basicField} tv-tnum px-2`}
              />
              <input
                type="time"
                dir="ltr"
                aria-label={tx("domArr")}
                value={time(leg.arrival_at)}
                onChange={(e) => setLeg(leg, { arrival_at: e.target.value ? `${day(leg.departure_at)}T${e.target.value}` : null })}
                className={`${basicField} tv-tnum px-2`}
              />
            </div>
          ))}
          <datalist id={listId}>
            {ranked.map((a) => (
              <option key={a.id} value={airportDisplay(a)} label={a.city ?? a.country ?? undefined} />
            ))}
          </datalist>
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
                onSlice({ flight_booking: { ...booking, dom_price: typedNumber(e.target), dom_currency: booking.dom_currency || "SAR" } })
              }
              className={`${basicField} tv-tnum w-32 text-center ${booking.dom_price == null ? "border-[#f0b4c2] bg-[#fff5f7]" : ""}`}
            />
            <span className="text-[#557d78]">{booking.dom_currency || "SAR"}</span>
          </label>
        </>
      )}
      <button
        type="button"
        onClick={onFlights}
        className="inline-flex h-7 items-center gap-1 text-[11.5px] font-bold text-[#557d78] hover:text-[#185045]"
      >
        <Plane className="size-3.5" />
        {tx("editFlights")}
      </button>
    </div>
  );
}
