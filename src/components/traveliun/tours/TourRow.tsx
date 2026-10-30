"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { FREE_DAY_TITLE, tourCars, type GeneratorLookups, type ServiceKind, type TourPick } from "@/lib/offer/draft-types";
import type { TranslationKey } from "@/lib/i18n";
import { programDayText, tourService, type TourProgram } from "@/lib/offer/itinerary";
import { findTourPrice, listedTourPrice, normalizeName, repricedTour, tourCarPrice, tourOffer, type TourPrice } from "@/lib/offer/pricing-suggest";
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
const caption = "text-[10.5px] font-bold text-tv-text-faint";
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A car in a tour's name — the old list filed a tour once per car: «جولة البسفور (فيتو)»، «… (باص كبير)». */
const VEHICLE = /^(?:سيار[ةه]|فان|ميني|باص|حافل[ةه]|فيتو|ليموزين|سبرانتر)/u;

/**
 * The services a city's tour field offers (the evaluator's Phuket list,
 * 2026-10-24): «يوم حر», then each tour of the city ONCE by its name — a
 * programme, or the price list's tour however many cars it is priced in —
 * sorted by name, its price the one for the trip's tours car (tourOffer: else
 * the nearest car's, named). Tours without a price follow; a placeholder (only
 * the 0096 «مؤقت» price) is left out while the city has a real tour, and
 * otherwise comes last.
 */
export function tourChoices(catalog: TourCatalog): Suggestion[] {
  const own = new Set(catalog.programs.map((p) => p.id));
  // a listed tour of another city's programme is that city's; one of this city's is its programme's own price
  const prices = catalog.prices.filter((p) => !p.program_id || own.has(p.program_id));
  /** a listed price as the file reads it: riyals, and a foreign price said in riyals first (≈ 563 ر.س (150 USD · فان)) */
  const money = (price: number, currency: string, car?: string) => {
    const rate = currency === "SAR" ? 1 : catalog.sarPer[currency];
    if (currency === "SAR" || !rate) return car ? `${price} ${currency} (${car})` : `${price} ${currency}`;
    return `≈ ${Math.round(price * rate).toLocaleString("en-US")} ر.س (${price} ${currency}${car ? ` · ${car}` : ""})`;
  };
  // the tours: the programmes, then the list's names with their car taken out
  const fleet = new Set(catalog.carTypes.map((c) => c.name.trim()));
  const baseOf = (name: string) => {
    const split = splitTourName(name);
    return split && (fleet.has(split.car) || VEHICLE.test(split.car)) ? split.base : name;
  };
  const tours = new Map<string, { value: string; programId?: string }>();
  for (const p of catalog.programs) {
    const value = programDayText(p).title;
    if (!p.is_free_day && !tours.has(normalizeName(value))) tours.set(normalizeName(value), { value, programId: p.id });
  }
  for (const t of prices) {
    const value = baseOf(t.name);
    if (!t.program_id && !tours.has(normalizeName(value))) tours.set(normalizeName(value), { value });
  }
  // a tour without a price says so (the owner, 2026-10-22) — never «≈ 0 ر.س»
  const NO_PRICE = "بدون سعر";
  const listed = [...tours.values()].map(({ value, programId }) => {
    const offer = tourOffer(prices, value, catalog.tripCar, programId, catalog.carTypes);
    const kind = !offer || offer.hit.price <= 0 ? "none" : offer.hit.provisional ? "placeholder" : "real";
    // another car's price names the car — the trip's has none for this tour
    const hint = !catalog.showPrice
      ? undefined
      : !offer || kind === "none"
        ? NO_PRICE
        : `${money(offer.hit.price, offer.hit.currency, offer.car !== catalog.tripCar.trim() ? offer.car : undefined)}${kind === "placeholder" ? " · مؤقت" : ""}`;
    return { kind, s: { value, ...tourGist(value), ...(hint ? { hint } : {}) } };
  });
  // each tour once: the same paragraph with «ثم التوصيل الى …» or without its dashes is the one already listed
  const seen = new Set<string>();
  const once = listed.filter(({ s }) => {
    // the same words, or the same title and places as the list shows them
    const keys = [tourKey(s.value), s.label ? `${s.label}|${s.sub ?? ""}` : ""].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
  const real = once.some((x) => x.kind === "real");
  const byName = (kind: string) =>
    once
      .filter((x) => x.kind === kind)
      .map((x) => x.s)
      .sort((a, b) => (a.label ?? a.value).localeCompare(b.label ?? b.value, "ar"));
  return [{ value: FREE_DAY_TITLE }, ...byName("real"), ...byName("none"), ...(real ? [] : byName("placeholder"))];
}

/**
 * What choosing `value` writes on a tour row (the tours tab and the
 * programme's day alike): the service and its price as the list shows it — for
 * the trip's tours car (tourOffer); else the nearest car's, and the tour then
 * goes in that car, since the price is that car's. Its car is stored only when
 * it is not the trip's; with no tours car chosen yet the tour waits for it. A
 * tour the list does not price keeps the row's price and car (typed by hand).
 */
export function chosenTour(catalog: TourCatalog, value: string, was: Pick<TourPick, "free" | "price">): Partial<TourPick> {
  const s = tourService(value, catalog.programs);
  if (s.free) return { ...s, price: 0 };
  const trip = catalog.tripCar.trim();
  const car = (trip && tourOffer(catalog.prices, value, trip, s.program_id, catalog.carTypes)?.car) || trip;
  const price = listedTourPrice(catalog.prices, catalog.sarPer, value, car, s.program_id);
  if (price == null) return { ...s, price: was.free ? null : was.price };
  return { ...s, price, car_type: car !== trip ? car : undefined };
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
            // a tour from the price list arrives priced for the tours car (or the car its price is for); a typed one keeps what was there
            onChange(chosenTour(catalog, value, pick));
          }}
          className={`${field} ${pick.free ? "text-tv-text-faint" : ""}`}
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
            // another car is another price: the list's for it, or none where the old car's list price was
            if (!tripCar) onTripCar(next);
            else onChange({ car_type: next && next !== tripCar ? next : undefined, price: repricedTour(pick, car, next || tripCar, prices, sarPer).price });
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
