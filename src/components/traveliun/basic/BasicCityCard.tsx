"use client";

import { useState, type ReactNode } from "react";
import { BedDouble, Camera, ChevronDown, Plane, Plus, Trash2, UserRound, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  BOARD_LABEL_KEYS,
  BOARD_TYPES,
  currencyOptions,
  deriveHotelStays,
  emptyRoomSpec,
  findLookupCountry,
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
  WELCOME,
  withTourCount,
  type BasicCity,
} from "@/lib/offer/basic";
import { programDayText, type TourProgram } from "@/lib/offer/itinerary";
import type { BoardType } from "@/lib/types";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { suppliersFor } from "../generator/SupplierPrice";
import { basicField, basicLabel } from "./styles";
import { nightsText, useBasicLabels } from "./labels";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const money = (n: number) => Math.round(n * 100) / 100;

type Tab = "hotel" | "tours" | "transfers" | "domestic";

/** What a room looks out on — offered, and any other can be typed. */
const VIEWS = ["إطلالة على المدينة", "إطلالة على البحر", "إطلالة جزئية على البحر", "إطلالة على الحديقة", "إطلالة على الجبل", "إطلالة على المسبح", "إطلالة على البحيرة", "إطلالة على النهر"];

/** «name (CODE)» → CODE, else the name. */
const airportShort = (airport: string) => airport.match(/\(([A-Za-z0-9]{3,5})\)/)?.[1] ?? airport;

/**
 * One city: its nights in the header, then four small tabs — the hotel, the
 * tours, the airport reception / farewell, the domestic flights — one open at a
 * time. Everything the trip already said (dates, rooms, meals, currency) is
 * filled in for the agent and kept under «معلومات إضافية».
 */
export function BasicCityCard({
  index,
  city,
  dayFrom,
  data,
  lookups,
  programs,
  hotelsOn,
  toursOn,
  transportOn,
  isFirst,
  isLast,
  hop,
  onNights,
  onTours,
  onPicks,
  onLines,
  onSlice,
  onCar,
  onSims,
  onFlights,
  onRemove,
}: {
  index: number;
  city: BasicCity;
  dayFrom: number;
  data: DraftData;
  lookups: GeneratorLookups;
  /** the ready-made tours of this city (tour_programs). */
  programs: TourProgram[];
  hotelsOn: boolean;
  toursOn: boolean;
  transportOn: boolean;
  /** the city the group lands in, and the one it flies home from. */
  isFirst: boolean;
  isLast: boolean;
  /** how the group gets here from the previous city, when the trip moves more than one way. */
  hop?: ReactNode;
  onNights: (nights: number) => void;
  onTours: (tours: number) => void;
  onPicks: (picks: TourPick[]) => void;
  /** replace these hotel lines (matched by id) — several at once, from one change. */
  onLines: (lines: DraftHotel[]) => void;
  onSlice: (slice: Partial<DraftData>) => void;
  /** the reception (airport) or farewell car changed. */
  onCar: (leg: "airport" | "farewell", slice: Partial<TransportLeg>) => void;
  onSims: (count: number) => void;
  /** open the flights step — the domestic legs are entered there. */
  onFlights: () => void;
  onRemove: () => void;
}) {
  const tx = useBasicLabels();
  const lines = cityLines(data.hotels, city.city_name);
  const [main, change] = lines;
  const domestic = data.flights.filter(
    (f) => f.leg_order === "internal" && (f.to_city?.trim() === city.city_name || f.from_city?.trim() === city.city_name),
  );
  const tabs: { key: Tab; label: string; icon: typeof Plane }[] = [
    ...(hotelsOn && main ? [{ key: "hotel" as const, label: tx("hotel"), icon: BedDouble }] : []),
    ...(toursOn ? [{ key: "tours" as const, label: tx("tours"), icon: Camera }] : []),
    ...(transportOn && (isFirst || isLast) ? [{ key: "transfers" as const, label: tx("transfersTab"), icon: UserRound }] : []),
    ...(domestic.length > 0 || (data.scope.flights_domestic && index > 0) ? [{ key: "domestic" as const, label: tx("domesticTab"), icon: Plane }] : []),
  ];
  const [tab, setTab] = useState<Tab>("hotel");
  const open = tabs.some((x) => x.key === tab) ? tab : tabs[0]?.key;

  return (
    <article className="overflow-hidden rounded-[14px] border border-[#d8e6e0] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <header className="flex flex-wrap items-center gap-2 bg-[#eef5f2] px-3 py-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-[#185045] text-[11px] font-extrabold text-white">{index + 1}</span>
        <h3 className="text-[13.5px] font-extrabold text-[#0f3d38]">{city.city_name}</h3>
        {city.country ? <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold text-[#557d78]">{city.country}</span> : null}
        {hop}
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

      {tabs.length > 0 ? (
        <div className="p-3">
          {/* the city's parts, one open at a time */}
          <div role="tablist" className="mb-3 flex flex-wrap gap-1.5">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={open === key}
                onClick={() => setTab(key)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-bold transition-colors ${
                  open === key ? "border-[#185045] bg-[#185045] text-white" : "border-[#DBE4E2] bg-white text-[#557d78] hover:border-[#165749]"
                }`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          {open === "hotel" && main ? (
            <HotelPanel index={index} city={city} dayFrom={dayFrom} data={data} lookups={lookups} main={main} change={change} lines={lines} onLines={onLines} onSlice={onSlice} />
          ) : null}
          {open === "tours" ? (
            <ToursPanel index={index} city={city} programs={programs} isFirst={isFirst} onTours={onTours} onPicks={onPicks} />
          ) : null}
          {open === "transfers" ? <TransfersPanel data={data} lookups={lookups} isFirst={isFirst} isLast={isLast} onCar={onCar} onSims={onSims} /> : null}
          {open === "domestic" ? (
            <div className="space-y-2">
              {domestic.length === 0 ? (
                <p className="text-[12px] font-semibold text-[#93aaa3]">{tx("noDomestic")}</p>
              ) : (
                domestic.map((f, k) => (
                  <p key={k} className="tv-tnum flex flex-wrap items-center gap-2 rounded-[10px] bg-[#f8fbf9] px-3 py-2 text-[12px] font-bold text-[#185045]">
                    <Plane className="size-3.5" />
                    <DirText dir="ltr">{`${f.flight_no || "—"} ${airportShort(f.from_airport)} → ${airportShort(f.to_airport)}`}</DirText>
                    {f.departure_at ? <DirText dir="ltr">{f.departure_at.replace("T", " ")}</DirText> : null}
                    {f.airline ? <span className="text-[#557d78]">{f.airline}</span> : null}
                  </p>
                ))
              )}
              <button
                type="button"
                onClick={onFlights}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#cfe0d9] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
              >
                <Plane className="size-3.5" />
                {tx("editFlights")}
              </button>
            </div>
          ) : null}
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
  const roomNames = [
    ...new Set(lookups.roomTypes.filter((r) => !main.hotel_id || r.hotel_id === main.hotel_id || r.hotel_id === null).map((r) => r.name.trim())),
  ].filter(Boolean);
  // a hotel the list does not hold (an older file) still shows its name
  const outside = main.hotel_name && !hotels.some((h) => h.id === main.hotel_id) ? (main.hotel_id ?? "__current") : null;

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
        value={value ?? ""}
        placeholder="0"
        onChange={(e) => onValue(e.target.value === "" ? null : Number(e.target.value))}
        className={`${basicField} tv-tnum text-center`}
      />
      {value != null ? (
        <span className="tv-tnum text-[10.5px] font-bold text-[#0f7a52]">
          {tx("perNightIs", { price: `${money(value / nights).toLocaleString("en-US")} ${currency}` })}
        </span>
      ) : null}
    </span>
  );

  return (
    <div className="space-y-2.5">
      <label className={`${basicLabel} max-w-xl`}>
        {tx("hotel")}
        <select
          value={outside ?? main.hotel_id ?? ""}
          onChange={(e) => {
            const h = hotels.find((x) => x.id === e.target.value);
            allLines((line) =>
              withRooms(
                { ...line, hotel_id: h?.id ?? null, hotel_name: h?.name ?? "", hotel_name_en: "", sourcing: null },
                // a room type belongs to its hotel: the old hotel's id must not follow
                line.rooms.map((r) => ({ ...r, room_type_id: null })),
              ),
            );
          }}
          className={basicField}
        >
          <option value="">{tx("choose")}</option>
          {outside ? <option value={outside}>{main.hotel_name}</option> : null}
          {hotels.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
              {h.stars ? ` ${"★".repeat(h.stars)}` : ""}
            </option>
          ))}
        </select>
      </label>

      {/* each room is a room of its own: its type, its view, its board, an extra bed, its price */}
      <div className="space-y-1.5">
        {main.rooms.map((r, j) => {
          const extra = r.room_type_name.endsWith(EXTRA_BED);
          return (
            <div key={j} className="flex flex-wrap items-start gap-2 rounded-[10px] bg-[#f8fbf9] p-2">
              <span className="mt-6 inline-flex h-6 items-center rounded-full bg-[#eef4f1] px-2 text-[10.5px] font-extrabold text-[#185045]">
                {tx("roomN", { n: j + 1 })}
              </span>
              <label className={`${basicLabel} w-56`}>
                {tx("roomType")}
                <input
                  list={`basic-rooms-${index}`}
                  value={baseRoomName(r.room_type_name)}
                  onChange={(e) => onLines([setRoom(main, j, { room_type_id: null, room_type_name: e.target.value + (extra ? EXTRA_BED : "") })])}
                  className={basicField}
                />
              </label>
              <label className={`${basicLabel} w-44`}>
                {tx("view")}
                <input list="basic-views" value={r.view ?? ""} onChange={(e) => onLines([setRoom(main, j, { view: e.target.value })])} className={basicField} />
              </label>
              <label className={`${basicLabel} w-36`}>
                {tx("board")}
                <select
                  value={r.board_type ?? ""}
                  onChange={(e) => onLines([setRoom(main, j, { board_type: (e.target.value || null) as BoardType | null })])}
                  className={basicField}
                >
                  <option value="">{tx("choose")}</option>
                  {BOARD_TYPES.map((b) => (
                    <option key={b} value={b}>{t(BOARD_LABEL_KEYS[b])}</option>
                  ))}
                </select>
              </label>
              <label className="mt-6 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[11.5px] font-bold text-[#185045]">
                <input
                  type="checkbox"
                  checked={extra}
                  onChange={(e) =>
                    onLines([setRoom(main, j, { room_type_name: baseRoomName(r.room_type_name) + (e.target.checked ? EXTRA_BED : "") })])
                  }
                  className="size-3.5 accent-[#185045]"
                />
                {tx("extraBed")}
              </label>
              <label className={`${basicLabel} w-32`}>
                {tx("stayPrice", { n: nightsText(mainNights, language) })}
                {priceField(r.price, mainNights, main.manual_currency, (price) => onLines([setRoom(main, j, { price })]), tx("stayPrice", { n: nightsText(mainNights, language) }))}
              </label>
              {main.rooms.length > 1 ? (
                <button
                  type="button"
                  onClick={() => allLines((line) => withRooms(line, line.rooms.filter((_, k) => k !== j)))}
                  aria-label={tx("removeRoom")}
                  className="mt-6 rounded-[7px] p-1.5 text-[#c43d3d] hover:bg-[#fff1f1]"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
          );
        })}
        <datalist id={`basic-rooms-${index}`}>
          {roomNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <datalist id="basic-views">
          {VIEWS.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        <div className="flex flex-wrap items-center gap-2">
          {/* a new room is a room of its own: its type and price are asked, the board follows */}
          <button
            type="button"
            onClick={() => allLines((line) => withRooms(line, [...line.rooms, { ...emptyRoomSpec(), board_type: line.rooms[0]?.board_type ?? null }]))}
            className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-dashed border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
          >
            <Plus className="size-3.5" />
            {tx("addRoom")}
          </button>
          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#cfe0d9] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
          >
            {tx("moreInfo")}
            <ChevronDown className={`size-3.5 transition-transform ${more ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {more ? (
        <div className="space-y-2.5 rounded-[11px] border border-dashed border-[#d6e6ef] bg-[#f8fbfc] p-2.5">
          {/* what the trip already decided — shown, never asked again */}
          <p className="tv-tnum flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold text-[#557d78]">
            <span>{tx("dayRange", { from: dayFrom, to: dayFrom + city.nights })}</span>
            {stays.map((s) =>
              s.check_in ? <DirText key={s.line.id}>{tx("stayDates", { in: s.check_in, out: s.check_out ?? "" })}</DirText> : null,
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <label className={`${basicLabel} w-28`}>
              {tx("currency")}
              <select value={main.manual_currency} onChange={(e) => allLines((line) => ({ ...line, manual_currency: e.target.value }))} className={basicField}>
                {currencyOptions(lookups.countries, main.manual_currency).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            {/* who the room was bought from — internal, never on the client document */}
            <label className={`${basicLabel} w-48`}>
              {t("pg.supplierLabel")}
              <select value={main.supplier ?? ""} onChange={(e) => allLines((line) => ({ ...line, supplier: e.target.value }))} className={basicField}>
                <option value="">{tx("choose")}</option>
                {suppliersFor(lookups, "فنادق").map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
          </div>

          {city.nights > 1 ? (
            <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[1fr_1.4fr_1fr]">
              <label className={basicLabel}>
                {tx("roomChange")}
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
              </label>
              {change ? (
                <>
                  <label className={basicLabel}>
                    {tx("newRoom")}
                    <input
                      list={`basic-rooms-${index}`}
                      value={baseRoomName(change.rooms[0]?.room_type_name ?? "")}
                      onChange={(e) => onLines([renameRooms(change, e.target.value)])}
                      className={basicField}
                    />
                  </label>
                  <label className={basicLabel}>
                    {tx("stayPrice", { n: nightsText(changeNights, language) })}
                    {priceField(
                      change.rooms[0]?.price ?? null,
                      changeNights,
                      change.manual_currency,
                      (price) => onLines([setAllRooms(change, { price })]),
                      tx("stayPrice", { n: nightsText(changeNights, language) }),
                    )}
                  </label>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToursPanel({
  index,
  city,
  programs,
  isFirst,
  onTours,
  onPicks,
}: {
  index: number;
  city: BasicCity;
  programs: TourProgram[];
  isFirst: boolean;
  onTours: (tours: number) => void;
  onPicks: (picks: TourPick[]) => void;
}) {
  const tx = useBasicLabels();
  const count = city.tours ?? 0;
  const picks = withTourCount(city.tour_picks, count);
  const offered = programs.filter((p) => !p.is_free_day).map((p) => ({ program: p, ...programDayText(p) }));
  const setPick = (k: number, slice: Partial<TourPick>) => onPicks(picks.map((p, i) => (i === k ? { ...p, ...slice } : p)));

  return (
    <div className="space-y-2">
      <label className={`${basicLabel} w-28`}>
        {tx("toursCount")}
        <select value={count} onChange={(e) => onTours(Number(e.target.value))} className={basicField}>
          {range(0, 15).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      {/* the company's own welcome comes first, on every file */}
      {isFirst ? (
        <p className="rounded-[10px] bg-[#EAF8F2] px-3 py-2 text-[12px] font-bold text-[#0F4339]">✓ {WELCOME}</p>
      ) : null}
      <datalist id={`basic-tours-${index}`}>
        {offered.map((o) => (
          <option key={o.program.id} value={o.title} />
        ))}
      </datalist>
      {picks.map((pick, k) => (
        <div key={k} className="grid grid-cols-[auto_1fr_8rem] items-end gap-2">
          <span className="mb-1.5 inline-flex h-6 items-center rounded-full bg-[#eef4f1] px-2 text-[10.5px] font-extrabold text-[#185045]">
            {tx("tourN", { n: k + 1 })}
          </span>
          <label className={basicLabel}>
            {tx("tourPick")}
            <input
              list={`basic-tours-${index}`}
              value={pick.title}
              placeholder={offered.length > 0 ? tx("tourPickHint") : `جولة سياحية في ${city.city_name}`}
              onChange={(e) => {
                const hit = offered.find((o) => o.title === e.target.value);
                setPick(k, hit ? { program_id: hit.program.id, title: hit.title, text: hit.activities[0] ?? "" } : { program_id: null, title: e.target.value, text: "" });
              }}
              className={basicField}
            />
          </label>
          <label className={basicLabel}>
            {tx("tourPrice")}
            <input
              type="number"
              min={0}
              dir="ltr"
              value={pick.price ?? ""}
              placeholder="0"
              onChange={(e) => setPick(k, { price: e.target.value === "" ? null : Number(e.target.value) })}
              className={`${basicField} tv-tnum text-center`}
            />
          </label>
        </div>
      ))}
    </div>
  );
}

function TransfersPanel({
  data,
  lookups,
  isFirst,
  isLast,
  onCar,
  onSims,
}: {
  data: DraftData;
  lookups: GeneratorLookups;
  isFirst: boolean;
  isLast: boolean;
  onCar: (leg: "airport" | "farewell", slice: Partial<TransportLeg>) => void;
  onSims: (count: number) => void;
}) {
  const tx = useBasicLabels();
  const plan = data.transport_plan;
  const outbound = data.flights.filter((f) => f.leg_order === "outbound");
  const inbound = data.flights.filter((f) => f.leg_order === "inbound");
  // the airports come from the flights: where the group lands, where it leaves from
  const arrivalAirport = outbound[outbound.length - 1]?.to_airport || "—";
  const departureAirport = inbound[0]?.from_airport || "—";
  const sims = Number(data.services.includes.find((l) => l.startsWith(SIM_LINE))?.match(/\d+/)?.[0] ?? 0);

  const carFields = (leg: "airport" | "farewell", value: TransportLeg) => (
    <>
      <label className={`${basicLabel} w-44`}>
        {tx("carType")}
        <select value={value.car_type} onChange={(e) => onCar(leg, { car_type: e.target.value })} className={basicField}>
          <option value="">{tx("choose")}</option>
          {lookups.carTypes.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
              {c.pax ? ` (${c.pax})` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className={`${basicLabel} w-16`}>
        {tx("cars")}
        <select value={value.cars} onChange={(e) => onCar(leg, { cars: Number(e.target.value) })} className={`${basicField} px-1.5`}>
          {range(1, 10).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
    </>
  );

  return (
    <div className="space-y-3">
      {isFirst ? (
        <div>
          <p className="mb-1.5 text-[12px] font-extrabold text-[#185045]">
            {tx("reception")} — <DirText>{arrivalAirport}</DirText>
          </p>
          <div className="flex flex-wrap items-end gap-2">
            {carFields("airport", plan.airport)}
            <label className={`${basicLabel} w-28`}>
              {tx("simLines")}
              <select value={sims} onChange={(e) => onSims(Number(e.target.value))} className={`${basicField} px-1.5`}>
                {range(0, 10).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}
      {isLast ? (
        <div>
          <p className="mb-1.5 text-[12px] font-extrabold text-[#185045]">
            {tx("farewell")} — <DirText>{departureAirport}</DirText>
          </p>
          <div className="flex flex-wrap items-end gap-2">{carFields("farewell", plan.farewell ?? plan.airport)}</div>
        </div>
      ) : null}
    </div>
  );
}

/** The «يشمل» line the reception's SIM count writes. */export const SIM_LINE = "شريحة اتصال";
