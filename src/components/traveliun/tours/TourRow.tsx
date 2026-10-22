"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { FREE_DAY_TITLE, tourCars, type GeneratorLookups, type ServiceKind, type TourPick } from "@/lib/offer/draft-types";
import type { TranslationKey } from "@/lib/i18n";
import { programDayText, tourService, type TourProgram } from "@/lib/offer/itinerary";
import { findTourPrice, listedTourPrice, tourCarPrice, type TourPrice } from "@/lib/offer/pricing-suggest";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { SuggestInput, type Suggestion } from "../SuggestInput";
import { basicField, typedNumber } from "../basic/styles";
import { splitTourName } from "@/lib/catalog/model";
import { tourGist, tourKey } from "@/lib/offer/tour-gist";

/**
 * A city's tours, as both screens choose them — the basic screen's city card
 * and the generator's «البرنامج اليومي والجولات»: the service (the city's ready
 * programmes and the price list, or typed), the car it goes in, how many, and
 * the price per car with its total (ق3: the line is the car's price × the cars).
 */

/** What one city's tours are chosen from — the same for every row of the city. */
export type TourCatalog = {
  city: string;
  /** the city's ready programmes (tour_programs). */
  programs: TourProgram[];
  /** the trip's tours price list. */
  prices: TourPrice[];
  sarPer: Record<string, number>;
  carTypes: GeneratorLookups["carTypes"];
  /** the trip's tours car — a tour without its own goes in it. */
  tripCar: string;
  /** the prices are shown (the generator: pricing.view). */
  showPrice: boolean;
};

/** The compact field both screens' tour rows use. */
export const tourField = basicField;
const caption = "text-[10.5px] font-bold text-[#7a948f]";
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The services a city's tour field offers: «يوم حر», its programmes, then the price list — each tour once. */
export function tourChoices(catalog: TourCatalog): Suggestion[] {
  const own = new Set(catalog.programs.map((p) => p.id));
  // a listed tour of another city's programme is that city's, not this one's
  const prices = catalog.prices.filter((p) => !p.program_id || own.has(p.program_id));
  const out = new Map<string, Suggestion>([[FREE_DAY_TITLE, { value: FREE_DAY_TITLE }]]);
  /** a listed price as the file reads it: riyals, and a foreign price said in riyals first (≈ 563 ر.س (150 USD · فان)) */
  const money = (price: number, currency: string, car?: string) => {
    const rate = currency === "SAR" ? 1 : catalog.sarPer[currency];
    if (currency === "SAR" || !rate) return car ? `${price} ${currency} (${car})` : `${price} ${currency}`;
    return `≈ ${Math.round(price * rate).toLocaleString("en-US")} ر.س (${price} ${currency}${car ? ` · ${car}` : ""})`;
  };
  // a tour without a price says so, at the end of the list (the owner, 2026-10-22) — never «≈ 0 ر.س»
  const NO_PRICE = "بدون سعر";
  const priced = (value: string, programId?: string) => {
    const hit = catalog.showPrice ? findTourPrice(prices, value, catalog.tripCar, programId) : null;
    const hint = !catalog.showPrice ? undefined : hit && hit.price > 0 ? `${money(hit.price, hit.currency)}${hit.provisional ? " · مؤقت" : ""}` : hit ? NO_PRICE : undefined;
    return { value, ...tourGist(value), ...(hint ? { hint } : {}) };
  };
  for (const p of catalog.programs) {
    const title = programDayText(p).title;
    if (!p.is_free_day && !out.has(title)) out.set(title, priced(title, p.id));
  }
  // one entry per tour: a tour priced per car is listed once, its price shown for the trip's car — and so is
  // one the old list filed once per car in its NAME («جولة البسفور (فيتو)»، «… (فان مرسيدس)»: three rows
  // of every tour, the owner's review 2026-10-18). Only a fleet car in the brackets is a car.
  const fleet = new Set(catalog.carTypes.map((c) => c.name.trim()));
  const baseOf = (name: string) => {
    const split = splitTourName(name);
    return split && fleet.has(split.car) ? split.base : name;
  };
  for (const name of new Set(prices.map((t) => baseOf(t.name)))) {
    if (out.has(name)) continue;
    const entry = priced(name);
    // the trip's car has no price for it: the nearest car that has one says what it costs, and says which car
    if (!entry.hint && catalog.showPrice) {
      // the smallest car that seats what the trip's car seats, else the biggest there is
      const paxOf = (car: string) => catalog.carTypes.find((c) => c.name.trim() === car)?.pax ?? 0;
      const need = paxOf(catalog.tripCar.trim());
      const others = prices
        .filter((t) => baseOf(t.name) === name && t.name !== name)
        .sort((x, y) => paxOf(splitTourName(x.name)!.car) - paxOf(splitTourName(y.name)!.car));
      const other = others.find((t) => paxOf(splitTourName(t.name)!.car) >= need) ?? others[others.length - 1];
      const car = other ? splitTourName(other.name)?.car : null;
      if (other && car && other.price > 0) out.set(name, { ...entry, hint: money(other.price, other.currency, car) });
      else out.set(name, { ...entry, ...(catalog.showPrice ? { hint: NO_PRICE } : {}) });
    } else out.set(name, entry);
  }
  // each tour once: the same paragraph with «ثم التوصيل الى …» or without its dashes is the one already listed
  const seen = new Set<string>();
  const once = [...out.values()].filter((s) => {
    // the same words, or the same title and places as the list shows them
    const keys = [tourKey(s.value), s.label ? `${s.label}|${s.sub ?? ""}` : ""].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
  return [...once.filter((s) => s.hint !== NO_PRICE), ...once.filter((s) => s.hint === NO_PRICE)];
}

/** The company's cars, and a car typed elsewhere that the list does not hold. */
export function CarOptions({ carTypes, placeholder, current }: { carTypes: GeneratorLookups["carTypes"]; placeholder: string; current?: string }) {
  return (
    <>
      <option value="">{placeholder}</option>
      {current && !carTypes.some((c) => c.name === current) ? <option value={current}>{current}</option> : null}
      {carTypes.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
          {c.pax ? ` (${c.pax})` : ""}
        </option>
      ))}
    </>
  );
}

/** How many cars: 1–10. */
export function CarCountSelect({
  value,
  onChange,
  label,
  className,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  className: string;
  disabled?: boolean;
}) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className={`${className} px-1.5`}>
      {range(1, 10).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

const SERVICE_KIND_KEYS: Record<ServiceKind, TranslationKey> = {
  reception: "pg.svc.reception",
  farewell: "pg.svc.farewell",
  transfer: "pg.svc.transfer",
  tour: "pg.svc.tour",
};

/** «نوع الخدمة»: what a row of a city's services is — a tour, or one of the trip's drives. */
export function ServiceKindSelect({
  value,
  kinds,
  onChange,
  className,
}: {
  value: ServiceKind;
  /** what the row may become — the sale's tours and transfers. */
  kinds: ServiceKind[];
  onChange: (kind: ServiceKind) => void;
  className: string;
}) {
  const { t } = useTraveliunUI();
  return (
    <select aria-label={t("pg.svc.kind")} value={value} onChange={(e) => onChange(e.target.value as ServiceKind)} className={`${className} px-1.5`}>
      {(kinds.includes(value) ? kinds : [value, ...kinds]).map((k) => (
        <option key={k} value={k}>
          {t(SERVICE_KIND_KEYS[k])}
        </option>
      ))}
    </select>
  );
}

/**
 * One tour: its day (when it may move — the basic screen), its service, car,
 * cars, price per car and total, and its wording (the generator's open day).
 * A service from the list arrives priced for its car; another car is another
 * price when the list has the tour for it.
 */
export function TourRow({
  pick,
  catalog,
  onChange,
  onTripCar,
  dates,
  dayLabel,
  describe,
  labelled,
  field,
  className,
  onRemove,
  kind,
  compact = false,
}: {
  pick: TourPick;
  catalog: TourCatalog;
  onChange: (slice: Partial<TourPick>) => void;
  /** no trip car yet: the first car chosen becomes the trip's. */
  onTripCar: (car: string) => void;
  /** the days it may move to. */
  dates?: string[];
  dayLabel?: (iso: string) => string;
  /** the programme's wording, editable. */
  describe?: boolean;
  /** captions over the fields; without them they are read aloud only (a heading row stands over them). */
  labelled?: boolean;
  field: string;
  className?: string;
  onRemove?: () => void;
  /** «نوع الخدمة» before the service — the basic screen's services table (ServiceKindSelect). */
  kind?: ReactNode;
  /**
   * The car and the cars as one line that opens («البيسك», the owner,
   * 2026-10-22: «دون فقد المميزات») — the trip's car until this tour has its
   * own — and the tour's whole wording one press away.
   */
  compact?: boolean;
}) {
  const { t } = useTraveliunUI();
  const [carOpen, setCarOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const { tripCar, prices, sarPer, showPrice } = catalog;
  const car = pick.car_type?.trim() || tripCar;
  const unit = tourCarPrice(pick, tripCar, prices, sarPer);
  const fromList = !pick.free && pick.price == null && unit != null;
  // a placeholder price says so until the real one is entered (0096) — taken from the list or carried as picked
  const listed = !pick.free && pick.title.trim() ? findTourPrice(prices, pick.title, car, pick.program_id) : null;
  const provisional = Boolean(listed?.provisional) && (fromList || pick.price === listedTourPrice(prices, sarPer, pick.title, car, pick.program_id));
  const cell = (label: string, control: ReactNode, wide = false) => (
    <label className={`grid min-w-0 gap-1 ${wide ? "col-span-full" : ""}`}>
      <span className={labelled ? caption : "sr-only"}>{label}</span>
      {control}
    </label>
  );

  return (
    <div className={className}>
      {dates
        ? cell(
            t("pg.tour.date"),
            <select value={pick.date ?? ""} onChange={(e) => onChange({ date: e.target.value || null })} className={field}>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {dayLabel ? dayLabel(d) : d}
                </option>
              ))}
            </select>,
          )
        : null}
      {kind ? cell(t("pg.svc.kind"), kind) : null}
      {cell(
        t("pg.tour.service"),
        <SuggestInput
          ariaLabel={t("pg.tour.service")}
          items={tourChoices(catalog)}
          value={pick.free ? FREE_DAY_TITLE : pick.title}
          placeholder={t("pg.tour.serviceHint", { city: catalog.city })}
          onChange={(value, picked) => {
            // the tour it already is, picked again, changes nothing (a typed price stays)
            if (picked && value === (pick.free ? FREE_DAY_TITLE : pick.title)) return;
            const s = tourService(value, catalog.programs);
            // a tour from the price list arrives priced for its car; a typed one keeps what was there
            onChange({ ...s, price: s.free ? 0 : (listedTourPrice(prices, sarPer, value, car, s.program_id) ?? (pick.free ? null : pick.price)) });
          }}
          className={`${field} ${pick.free ? "text-[#7a948f]" : ""}`}
        />,
      )}
      {compact && !carOpen && !pick.free ? (
        <>
          {cell(
            t("pg.tour.car"),
            <button
              type="button"
              onClick={() => setCarOpen(true)}
              className={`${field} inline-flex items-center justify-between gap-1 text-start ${pick.car_type?.trim() && pick.car_type.trim() !== tripCar ? "font-extrabold" : "text-[#557d78]"}`}
            >
              <span className="min-w-0 truncate">{`${car || t("pg.tour.car")} × ${tourCars(pick)}`}</span>
              <ChevronDown className="size-3.5 shrink-0" />
            </button>,
          )}
          <span className="max-xl:hidden" />
        </>
      ) : null}
      {compact && !carOpen && !pick.free ? null : cell(
        t("pg.tour.car"),
        <select
          value={car}
          disabled={pick.free}
          onChange={(e) => {
            const next = e.target.value;
            // another car is another price, when the list has the tour for it
            const listed = pick.title.trim() ? listedTourPrice(prices, sarPer, pick.title, next, pick.program_id) : null;
            if (!tripCar) onTripCar(next);
            else onChange({ car_type: next && next !== tripCar ? next : undefined, ...(listed != null ? { price: listed } : {}) });
          }}
          className={field}
        >
          <CarOptions carTypes={catalog.carTypes} placeholder={t("pg.tour.car")} current={car} />
        </select>,
      )}
      {compact && !carOpen && !pick.free ? null : cell(t("pg.tour.cars"), <CarCountSelect value={tourCars(pick)} disabled={pick.free} onChange={(cars) => onChange({ cars })} label={t("pg.tour.cars")} className={field} />)}
      {showPrice
        ? cell(
            t("pg.tour.carPrice"),
            <span className="grid gap-0.5">
              <input
                type="number"
                min={0}
                dir="ltr"
                disabled={pick.free}
                value={pick.free ? 0 : (pick.price ?? "")}
                // the list's figure shows through until one is typed
                placeholder={fromList ? String(unit) : "0"}
                onChange={(e) => onChange({ price: typedNumber(e.target) })}
                className={`${field} tv-tnum text-center disabled:bg-[#f4f7f6]`}
              />
              {fromList || provisional ? (
                <span className={`text-[10px] font-bold ${provisional ? "text-[#b54708]" : "text-[#0f7a52]"}`}>
                  {fromList ? t("pg.tour.fromList") : null}
                  {fromList && provisional ? " · " : null}
                  {provisional ? t("pg.tour.provisional") : null}
                </span>
              ) : null}
            </span>,
          )
        : null}
      {showPrice ? (
        <div className="grid min-w-0 gap-1">
          <span className={labelled ? caption : "sr-only"}>{t("pg.tour.total")}</span>
          <output className="tv-tnum inline-flex h-9 items-center justify-center rounded-[8px] bg-[#eef4f1] px-2 text-[12.5px] font-extrabold text-[#185045]">
            {pick.free ? "—" : unit != null ? `${(unit * tourCars(pick)).toLocaleString("en-US")} SAR` : "—"}
          </output>
        </div>
      ) : null}
      {describe
        ? cell(
            t("pg.tour.description"),
            <textarea
              value={pick.text}
              disabled={pick.free}
              onChange={(e) => onChange({ text: e.target.value })}
              rows={2}
              className="w-full rounded-[10px] border border-[#dbe6e1] bg-white p-2.5 text-[13px] leading-6 text-[#185045] outline-none transition-colors focus:border-[#2aa87a] disabled:bg-[#f4f7f6]"
            />,
            true,
          )
        : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("pg.tour.remove")}
          title={t("pg.tour.remove")}
          className="inline-flex size-9 items-center justify-center self-end rounded-[8px] text-[#c43d3d] hover:bg-[#fff1f1]"
        >
          <X className="size-4" />
        </button>
      ) : null}
      {compact && !describe && pick.text.trim() && !pick.free ? (
        <div className="col-span-full">
          <button type="button" onClick={() => setTextOpen((v) => !v)} aria-expanded={textOpen} className="inline-flex items-center gap-1 text-[11px] font-bold text-[#557d78] hover:text-[#185045]">
            {t("pg.tour.description")}
            <ChevronDown className={`size-3 transition-transform ${textOpen ? "rotate-180" : ""}`} />
          </button>
          {textOpen ? (
            <textarea
              value={pick.text}
              onChange={(e) => onChange({ text: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-[10px] border border-[#dbe6e1] bg-white p-2.5 text-[12.5px] leading-6 text-[#185045] outline-none focus:border-[#2aa87a]"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
