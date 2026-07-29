"use client";

import { useEffect, useRef, useState } from "react";
import { BedDouble, Check, ListChecks, Loader2, MapPin, Minus, Search, Tag, UserRound, Users } from "lucide-react";
import { DirText } from "@/components/DirText";
import { searchCustomersFromTeletel, type TeletelCustomerHit } from "@/lib/data/teletel-actions";
import {
  BOARD_LABEL_KEYS,
  BOARD_TYPES,
  SCOPE_KEYS,
  resizeAges,
  type DraftHotel,
  type DraftScope,
} from "@/lib/offer/draft-types";
import type { TranslationKey } from "@/lib/i18n";
import type { BoardType } from "@/lib/types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass, labelClass, sectionClass, type StageFormProps } from "../stage-props";

const SCOPE_LABEL_KEYS: Record<keyof DraftScope, TranslationKey> = {
  flights: "pg.stage.flights",
  hotels: "pg.stage.hotels",
  visas: "pg.stage.visas",
  transport: "pg.stage.transport",
};

/**
 * Stage 1 — customer / company.
 * Primary path: pick the customer from Teletel (search by name/phone) — one tap
 * fills name+phone, and label-derived destinations («رحلة جورجيا») become chips
 * that fill the trip destination. Manual fields stay as the fallback.
 */
export function CustomerStage({ data, patch, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const customer = data.customer;

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TeletelCustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [open, setOpen] = useState(false);
  const [destinations, setDestinations] = useState<string[]>([]);
  const seqRef = useRef(0);

  function update(patchSlice: Partial<typeof customer>) {
    patch({ customer: { ...customer, ...patchSlice } });
  }

  // debounced Teletel search (350ms); stale responses dropped via seq counter.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const id = window.setTimeout(async () => {
      const res = await searchCustomersFromTeletel(q);
      if (seqRef.current !== seq) return;
      setSearching(false);
      if (!res.ok) return;
      setConfigured(res.configured);
      setHits(res.hits);
      setOpen(true);
    }, 350);
    return () => window.clearTimeout(id);
  }, [query]);

  function pick(hit: TeletelCustomerHit) {
    update({ customer_name: hit.name, customer_phone: hit.phone });
    setDestinations(hit.destinations);
    setQuery("");
    setHits([]);
    setOpen(false);
  }

  function applyDestination(name: string) {
    patch({ trip: { ...data.trip, country: name, destination: name } });
    setDestinations((prev) => prev.filter((d) => d !== name));
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-4 text-base font-extrabold text-[#003c3a]">{t("pg.customerTitle")}</h2>

      {/* Teletel lookup */}
      <div className="relative mb-4">
        <span className="mb-1.5 block text-[12px] font-bold text-[#557d78]">{t("tl.search")}</span>
        <div className="relative">
          {searching ? (
            <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-[#8aa29b]" />
          ) : (
            <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-[#8aa29b]" />
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => hits.length > 0 && setOpen(true)}
            placeholder={t("tl.searchPlaceholder")}
            className={`${fieldClass} pe-10`}
          />
        </div>
        {!configured ? (
          <p className="mt-1.5 text-[11.5px] font-semibold text-[#a86a10]">{t("tl.notConfigured")}</p>
        ) : null}
        {open && configured && query.trim().length >= 2 ? (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-[11px] border border-[#e2ebe7] bg-white shadow-lg dark:border-[#294039] dark:bg-[#0f1f1b]">
            {hits.length === 0 && !searching ? (
              <p className="px-4 py-3 text-[12.5px] font-semibold text-[#93aaa3]">{t("tl.noResults")}</p>
            ) : (
              hits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => pick(hit)}
                  className="flex w-full items-center gap-3 border-b border-[#f1f5f3] px-4 py-2.5 text-start last:border-b-0 hover:bg-[#f4f8f6] dark:border-[#1c302a] dark:hover:bg-[#12352c]"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eef4f1] text-[#185045] dark:bg-[#12352c] dark:text-[#7fd0b2]">
                    <UserRound className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-extrabold text-[#0f3d38] dark:text-[#eaf3ef]">
                      {hit.name || t("tl.unnamed")}
                    </span>
                    <span className="block truncate text-[12px] font-semibold text-[#8aa29b]">
                      <DirText dir="ltr">{hit.phone || hit.email}</DirText>
                    </span>
                  </span>
                  {hit.labels.length > 0 ? (
                    <span className="flex max-w-[45%] flex-wrap justify-end gap-1">
                      {hit.labels.slice(0, 2).map((label) => (
                        <span key={label} className="inline-flex items-center gap-1 rounded-full bg-[#fff4dd] px-2 py-0.5 text-[10.5px] font-bold text-[#8a5a0c]">
                          <Tag className="size-3" /> {label}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* destination suggestions pulled from the picked contact */}
      {destinations.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[11px] border border-[#bfe5d4] bg-[#e9f7f0] px-3 py-2.5">
          <span className="text-[12px] font-bold text-[#0f7a52]">{t("tl.destFromLabels")}</span>
          {destinations.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => applyDestination(name)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#0f7a52] px-3 text-[12px] font-bold text-white hover:bg-[#0c6543]"
            >
              <MapPin className="size-3.5" /> {t("tl.addDestination", { name })}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          {t("pg.customerName")}
          <input
            value={customer.customer_name}
            onChange={(e) => update({ customer_name: e.target.value })}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          {t("pg.customerPhone")}
          <input
            dir="ltr"
            inputMode="tel"
            value={customer.customer_phone}
            onChange={(e) => update({ customer_phone: e.target.value })}
            className={`${fieldClass} tv-tnum text-start`}
            placeholder="05xxxxxxxx"
          />
        </label>
        <label className={`${labelClass} md:col-span-2`}>
          {t("pg.company")}
          <input
            value={customer.company}
            onChange={(e) => update({ company: e.target.value })}
            className={fieldClass}
          />
        </label>
      </div>

      <TravelersBlock data={data} patch={patch} />
      <RoomsBlock data={data} patch={patch} lookups={lookups} />
      <ScopeBlock data={data} patch={patch} />
    </section>
  );
}

const blockClass = "mt-5 border-t border-[#e7f0ec] pt-5";
const blockTitleClass = "flex items-center gap-2 text-[13.5px] font-extrabold text-[#0f3d38]";
const smallLabelClass = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

/**
 * Travelers live WITH the customer, not with the trip frame: "who is going" is
 * the first thing an agent is told on the phone. Ages are captured too — a
 * child's age changes the hotel rate and the airline fare, so "2 children" with
 * no ages is a quote the supplier can reprice after the client has agreed.
 */
function TravelersBlock({ data, patch }: Pick<StageFormProps, "data" | "patch">) {
  const { t } = useTraveliunUI();
  const trip = data.trip;

  /** Counts and ages move together — the ages list is always count-long. */
  function setCount(field: "children" | "infants", raw: number) {
    const count = Math.max(Math.trunc(raw) || 0, 0);
    const agesField = field === "children" ? "children_ages" : "infant_ages";
    patch({ trip: { ...trip, [field]: count, [agesField]: resizeAges(trip[agesField], count) } });
  }

  function setAge(field: "children_ages" | "infant_ages", index: number, raw: number) {
    const next = trip[field].map((age, i) => (i === index ? Math.max(Math.trunc(raw) || 0, 0) : age));
    patch({ trip: { ...trip, [field]: next } });
  }

  return (
    <div className={blockClass}>
      <h3 className={blockTitleClass}>
        <Users className="size-4 text-[#185045]" />
        {t("pg.travelersTitle")}
      </h3>

      <div className="mt-3 grid grid-cols-3 gap-4">
        <label className={smallLabelClass}>
          {t("pg.adults")}
          <input
            type="number" min={0} dir="ltr"
            value={trip.adults}
            onChange={(e) => patch({ trip: { ...trip, adults: Math.max(Number(e.target.value) || 0, 0) } })}
            className={`${fieldClass} tv-tnum text-center`}
          />
        </label>
        <label className={smallLabelClass}>
          {t("pg.children")}
          <input
            type="number" min={0} dir="ltr"
            value={trip.children}
            onChange={(e) => setCount("children", Number(e.target.value))}
            className={`${fieldClass} tv-tnum text-center`}
          />
        </label>
        <label className={smallLabelClass}>
          {t("pg.infants")}
          <input
            type="number" min={0} dir="ltr"
            value={trip.infants}
            onChange={(e) => setCount("infants", Number(e.target.value))}
            className={`${fieldClass} tv-tnum text-center`}
          />
        </label>
      </div>

      {trip.children_ages.length > 0 || trip.infant_ages.length > 0 ? (
        <div className="mt-3 rounded-[11px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
          <p className="mb-2 text-[11.5px] font-bold text-[#557d78]">{t("pg.agesHint")}</p>
          <div className="flex flex-wrap gap-2">
            {trip.children_ages.map((age, i) => (
              <AgeField
                key={`c${i}`}
                label={t("pg.childAgeN", { n: i + 1 })}
                value={age}
                onChange={(v) => setAge("children_ages", i, v)}
              />
            ))}
            {trip.infant_ages.map((age, i) => (
              <AgeField
                key={`i${i}`}
                label={t("pg.infantAgeN", { n: i + 1 })}
                value={age}
                onChange={(v) => setAge("infant_ages", i, v)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AgeField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="grid gap-1 text-[11px] font-bold text-[#557d78]">
      {label}
      <input
        type="number" min={0} max={17} dir="ltr"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${fieldClass} tv-tnum h-9 w-20 text-center`}
      />
    </label>
  );
}

/**
 * Room defaults, entered once here and inherited by every city.
 *
 * Changing a default re-applies it ONLY to hotel lines that still carry the old
 * one. A city where the agent deliberately booked an extra room (the driver's,
 * which is never labelled as such) keeps its own number.
 */
function RoomsBlock({ data, patch, lookups }: Pick<StageFormProps, "data" | "patch" | "lookups">) {
  const { t } = useTraveliunUI();
  const trip = data.trip;

  function applyDefault<K extends "rooms_count" | "room_type_id" | "board_type">(
    field: K,
    oldValue: DraftHotel[K],
    newValue: DraftHotel[K],
    extra?: Partial<DraftHotel>,
  ) {
    return data.hotels.map((h) => (h[field] === oldValue ? { ...h, [field]: newValue, ...extra } : h));
  }

  function setRooms(raw: number) {
    const rooms = Math.max(Math.trunc(raw) || 1, 1);
    patch({ trip: { ...trip, rooms }, hotels: applyDefault("rooms_count", trip.rooms, rooms) });
  }

  function setRoomType(id: string) {
    const rt = lookups.roomTypes.find((r) => r.id === id) ?? null;
    patch({
      trip: { ...trip, default_room_type_id: rt?.id ?? null, default_room_type_name: rt?.name ?? "" },
      hotels: applyDefault("room_type_id", trip.default_room_type_id, rt?.id ?? null, {
        room_type_name: rt?.name ?? "",
      }),
    });
  }

  function setBoard(value: string) {
    const board = value === "" ? null : (value as BoardType);
    patch({ trip: { ...trip, default_board: board }, hotels: applyDefault("board_type", trip.default_board, board) });
  }

  return (
    <div className={blockClass}>
      <h3 className={blockTitleClass}>
        <BedDouble className="size-4 text-[#185045]" />
        {t("pg.roomsTitle")}
      </h3>
      <p className="mt-1 text-[11.5px] font-semibold text-[#93aaa3]">{t("pg.roomsHint")}</p>

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <label className={smallLabelClass}>
          {t("pg.roomsCount")}
          <input
            type="number" min={1} dir="ltr"
            value={trip.rooms}
            onChange={(e) => setRooms(Number(e.target.value))}
            className={`${fieldClass} tv-tnum text-center`}
          />
        </label>
        <label className={smallLabelClass}>
          {t("pg.roomType")}
          <select value={trip.default_room_type_id ?? ""} onChange={(e) => setRoomType(e.target.value)} className={fieldClass}>
            <option value="">{t("pg.chooseRoomType")}</option>
            {lookups.roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>{rt.name}</option>
            ))}
          </select>
        </label>
        <label className={smallLabelClass}>
          {t("pg.board")}
          <select value={trip.default_board ?? ""} onChange={(e) => setBoard(e.target.value)} className={fieldClass}>
            <option value="">{t("pg.chooseBoard")}</option>
            {BOARD_TYPES.map((b) => (
              <option key={b} value={b}>{t(BOARD_LABEL_KEYS[b])}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/** Service scope — the switches that decide which stages exist for this offer. */
function ScopeBlock({ data, patch }: Pick<StageFormProps, "data" | "patch">) {
  const { t } = useTraveliunUI();
  const scope = data.scope;

  return (
    <div className={blockClass}>
      <h3 className={blockTitleClass}>
        <ListChecks className="size-4 text-[#185045]" />
        {t("pg.scopeTitle")}
      </h3>
      <p className="mt-1 text-[11.5px] font-semibold text-[#93aaa3]">{t("pg.scopeHint")}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {SCOPE_KEYS.map((key) => {
          const on = scope[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => patch({ scope: { ...scope, [key]: !on } })}
              aria-pressed={on}
              className={`flex items-center gap-2 rounded-[11px] border px-3 py-2.5 text-[13px] font-bold transition-colors ${
                on
                  ? "border-[#185045] bg-[#185045] text-white"
                  : "border-[#dbe6e1] bg-white text-[#93aaa3] hover:bg-[#f4f8f6]"
              }`}
            >
              {on ? <Check className="size-4" /> : <Minus className="size-4" />}
              {t(SCOPE_LABEL_KEYS[key])}
            </button>
          );
        })}
      </div>
    </div>
  );
}
