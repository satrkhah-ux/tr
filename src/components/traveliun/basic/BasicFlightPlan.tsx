"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Search, X } from "lucide-react";
import type { DraftData, DraftFlight, GeneratorLookups } from "@/lib/offer/draft-types";
import { airportDisplay, findAirport, planInternational, rankAirports, tripCountries, type FlightPlan } from "@/lib/offer/basic";
import { applyFlightHit, changeLeg, type LegChange } from "@/lib/offer/basic-flights";
import { parseFlightNumber } from "@/lib/offer/flight-number";
import { withTypedTotal } from "@/lib/offer/flight-fare";
import { localDatePart, localTimePart } from "@/lib/offer/schedule";
import { getAssistantAvailability, lookupFlightNumber } from "@/lib/data/itinerary-actions";
import type { FlightLookupHit } from "@/lib/providers/flight-lookup";
import { CabinOptions } from "../generator/flights/FlightBuilder";
import { FlightFare } from "../generator/flights/FlightFare";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { SuggestInput, type Suggestion } from "../SuggestInput";
import { basicField, typedNumber } from "./styles";
import { useBasicLabels } from "./labels";

/** Keep field labels visible when the card wraps, regardless of viewport width. */
const SMALL_CAPTION = "text-[10px] font-bold text-tv-text-faint";

type Look = { busy?: boolean; note?: string; hits?: FlightLookupHit[] };

/** The airports as the leg fields suggest them: home first for a departure from home, the package's own for the rest. */
export function airportItems(data: DraftData, airports: GeneratorLookups["airports"]): { home: Suggestion[]; dest: Suggestion[] } {
  const asItems = (list: GeneratorLookups["airports"]): Suggestion[] =>
    list.map((a) => ({ value: airportDisplay(a), hint: a.city ?? a.country ?? undefined, keywords: [a.city, a.country, a.code, a.name_en].filter(Boolean).join(" ") }));
  return {
    home: asItems(rankAirports(airports, "home")),
    dest: asItems(rankAirports(airports, tripCountries(data), data.cities.map((c) => c.city_name))),
  };
}

/** «جلب» only where the service is on (/developer) and its key is set — asked once a page. */
let canFetchOnce: Promise<boolean> | null = null;
export function useCanFetch(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    canFetchOnce ??= getAssistantAvailability()
      .then((a) => a.flightLookup)
      .catch(() => {
        canFetchOnce = null;
        return false;
      });
    let live = true;
    void canFetchOnce.then((v) => live && setCan(v));
    return () => {
      live = false;
    };
  }, []);
  return can;
}

/**
 * One flight leg on one line — the international legs in the flights step, a
 * domestic leg on its move between two cities. The number first («جلب»
 * fills the airline, the airports and the clocks; the day stays the agent's),
 * then the two airports, the day and the two clocks — every field editable —
 * and, for a domestic leg, its ticket «للفرد» (`price`).
 */
export function LegRow({
  leg,
  name,
  items,
  airports,
  airlines,
  canFetch,
  onEdit,
  onHit,
  onRemove,
  price,
  after,
}: {
  leg: DraftFlight;
  name: string | null;
  items: { from: Suggestion[]; to: Suggestion[] };
  airports: GeneratorLookups["airports"];
  airlines: GeneratorLookups["airlines"];
  canFetch: boolean;
  onEdit: (change: LegChange) => void;
  /** a looked-up flight laid onto the leg: its date to be checked, or its clocks left unfilled (they land before they take off) */
  onHit: (hit: FlightLookupHit) => { checkDate: boolean; badTimes: boolean } | null;
  onRemove?: () => void;
  /** the ticket's price field — a domestic leg's, «للفرد» */
  price?: { label: string; caption?: string | null };
  /** under the row: what the leg still lacks */
  after?: ReactNode;
}) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const [look, setLook] = useState<Look>({});
  const isDom = leg.leg_order === "internal";
  const day = localDatePart(leg.departure_at) ?? "";
  const time = (v: string | null) => {
    const x = localTimePart(v) ?? "";
    return x === "00:00" ? "" : x;
  };
  const nextDay = Boolean(day && leg.arrival_at && localDatePart(leg.arrival_at)! > day);

  /**
   * A city or a code typed and left becomes its airport («طرابزون» → «مطار طرابزون (TZX)»): free
   * text has no zone and no city, so the cities could not be built from it (the evaluator, 2026-10-22).
   * On leaving the field, never while typing — «IST» would jump before «Istanbul» is finished.
   */
  function settle(field: "from_airport" | "to_airport", typed: string) {
    const a = findAirport(typed, airports);
    if (a && airportDisplay(a) !== typed.trim()) onEdit({ [field]: airportDisplay(a) });
  }

  /** «MH1430» names its carrier: the airline fills in as the number is typed */
  function typeNumber(value: string) {
    const no = value.toUpperCase().replace(/\s+/g, "");
    const carrier = airlines.find((a) => a.iata && a.iata.toUpperCase() === parseFlightNumber(no)?.carrier);
    onEdit({ flight_no: no, ...(carrier ? { airline: carrier.name, airline_iata: carrier.iata } : {}) });
    setLook({});
  }

  function apply(hit: FlightLookupHit) {
    const out = onHit(hit);
    setLook({ note: out?.badTimes ? tx("flightTimesOff") : out?.checkDate && hit.schedule_date ? tx("checkDate", { date: hit.schedule_date }) : undefined });
  }

  async function fetchLeg() {
    setLook({ busy: true });
    try {
      const res = await lookupFlightNumber(leg.flight_no);
      if (!res.ok) return setLook({ note: res.error === "pg.flightLookup.err.notFound" ? tx("flightNotFound") : t(res.error) });
      if (res.hits.length === 1) return apply(res.hits[0]);
      setLook({ hits: res.hits });
    } catch {
      setLook({ note: tx("flightNotFound") });
    }
  }

  return (
    <div className="min-w-0 space-y-1">
      {/* Fit the available card width, including sidebar and browser zoom. */}
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] items-start gap-3">
        {name ? <span className="col-span-full text-[11.5px] font-extrabold text-[#0f3d38]">{name}</span> : null}
        {/* the number first: «جلب» fills the rest */}
        <span className="grid min-w-0 gap-0.5">
          <span className={SMALL_CAPTION}>{tx("domFlightNo")}</span>
          <span className="flex min-w-0 items-center gap-1">
          <input
            dir="ltr"
            aria-label={tx("domFlightNo")}
            // a word, not a flight: a sample number read as one on every leg (the evaluator, 2026-10-24)
            placeholder={tx("domFlightNo")}
            value={leg.flight_no}
            onChange={(e) => typeNumber(e.target.value)}
            className={`${basicField} tv-tnum min-w-0 text-center`}
          />
          {canFetch ? (
            <button
              type="button"
              onClick={() => void fetchLeg()}
              disabled={look.busy || !leg.flight_no.trim() || (isDom && !day)}
              title={isDom && !day ? tx("needDate") : tx("fetchHint")}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[8px] border border-[#185045] px-2 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4] disabled:opacity-45"
            >
              {look.busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
              {tx("fetchFlight")}
            </button>
          ) : null}
          </span>
        </span>
        <span className="grid min-w-0 gap-0.5" onBlur={() => settle("from_airport", leg.from_airport)}>
          <span className={SMALL_CAPTION}>{tx("planFrom")}</span>
          <SuggestInput ariaLabel={tx("planFrom")} placeholder={tx("planFrom")} items={items.from} value={leg.from_airport} onChange={(v) => onEdit({ from_airport: v })} className={basicField} />
        </span>
        <span className="grid min-w-0 gap-0.5" onBlur={() => settle("to_airport", leg.to_airport)}>
          <span className={SMALL_CAPTION}>{tx("planTo")}</span>
          <SuggestInput ariaLabel={tx("planTo")} placeholder={tx("planTo")} items={items.to} value={leg.to_airport} onChange={(v) => onEdit({ to_airport: v })} className={basicField} />
        </span>
        {/* under the wide row a phone shows an empty time as a blank box: each says what it is there */}
        <label className="grid min-w-0 gap-0.5">
          <span className={SMALL_CAPTION}>{tx("domDate")}</span>
          <input type="date" dir="ltr" aria-label={tx("domDate")} value={day} onChange={(e) => onEdit({ date: e.target.value })} className={`${basicField} tv-tnum min-w-0 max-w-full px-2`} />
        </label>
        <label className="grid min-w-0 gap-0.5">
          <span className={SMALL_CAPTION}>{tx("domDep")}</span>
          <input type="time" dir="ltr" aria-label={tx("domDep")} value={time(leg.departure_at)} disabled={!day} onChange={(e) => onEdit({ dep: e.target.value })} className={`${basicField} tv-tnum min-w-0 max-w-full px-2`} />
        </label>
        <span className="grid min-w-0 gap-0.5">
          <span className={SMALL_CAPTION}>{tx("domArr")}</span>
          <span className="flex items-center gap-1">
            <input type="time" dir="ltr" aria-label={tx("domArr")} value={time(leg.arrival_at)} disabled={!day} onChange={(e) => onEdit({ arr: e.target.value })} className={`${basicField} tv-tnum min-w-0 max-w-full px-2`} />
            {nextDay ? (
              <span title={tx("nextDayHint", { city: leg.to_city ?? "" })} className="tv-tnum shrink-0 rounded-full bg-[#fff4dc] px-1.5 py-0.5 text-[10.5px] font-extrabold text-[#a86a10]">
                {tx("nextDay")}
              </span>
            ) : null}
          </span>
        </span>
        {price ? (
          <span className="grid min-w-0 gap-0.5">
            <span className={SMALL_CAPTION}>{price.label}</span>
            <input
              type="number" inputMode="decimal"
              min={0}
              dir="ltr"
              aria-label={price.label}
              placeholder={price.label}
              value={leg.price ?? ""}
              onChange={(e) => onEdit({ price: typedNumber(e.target) })}
              className={`${basicField} tv-tnum min-w-0 text-center`}
            />
            {price.caption ? <span className="tv-tnum text-center text-[10px] font-bold text-[#557d78]">{price.caption}</span> : null}
          </span>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            aria-label={tx("removeLeg")}
            title={tx("removeLeg")}
            onClick={onRemove}
            className="inline-flex size-8 items-center justify-center rounded-[7px] text-[#c43d3d] hover:bg-[#fff1f1]"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {look.note ? <p className="text-[11px] font-bold text-[#a86a10]">{look.note}</p> : null}
      {look.hits ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-[#557d78]">
          {tx("pickRoute")}
          {look.hits.map((hit, i) => (
            <button key={i} type="button" onClick={() => apply(hit)} className="tv-tnum rounded-[7px] border border-[#cfe0d9] bg-[#f4f8f6] px-2 py-1 text-[#185045] hover:bg-[#e7f2ec]">
              {`${hit.from_iata} → ${hit.to_iata} ${localTimePart(hit.departure_at) ?? ""}`}
            </button>
          ))}
        </div>
      ) : null}
      {after}
    </div>
  );
}

/**
 * The flights step (the owner, 2026-10-22): the INTERNATIONAL flights — they
 * set the trip's dates — each leg asked by its NUMBER, which «جلب» turns into
 * the airline, the two airports and the clocks (the day stays the agent's), the
 * agent typing the price. The domestic legs are no longer here: each sits on its
 * move in the domestic flights' section, after the hotels (BasicHopFlight).
 * «أضف لاحقاً» leaves the international flights for later. Nothing here blocks.
 */
export function BasicFlightPlan({
  data,
  lookups,
  defaults,
  onChange,
  current,
}: {
  data: DraftData;
  lookups: GeneratorLookups;
  /** what the flight usually is (out of Madinah, into the package's country) — the first legs. */
  defaults: FlightPlan;
  onChange: (slice: Partial<DraftData>) => void;
  /** the file as it is now — a lookup lands after other edits */
  current: () => DraftData;
}) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const booking = data.flight_booking;
  const intl = data.flights.filter((f) => f.leg_order !== "internal");
  const round = booking.mode !== "oneway";
  const canFetch = useCanFetch();
  const { home, dest } = airportItems(data, lookups.airports);

  /** one leg changed, on the file as it is now */
  const edit = (id: string, change: LegChange) => onChange({ flights: changeLeg(current(), lookups.airports, id, change) });

  function hit(id: string, h: FlightLookupHit) {
    const d = current();
    const leg = d.flights.find((f) => f.id === id);
    if (!leg) return null;
    const out = applyFlightHit(leg, h, { airports: lookups.airports, airlines: lookups.airlines, trip: d.trip });
    onChange({ flights: d.flights.map((f) => (f.id === id ? out.leg : f)) });
    return out;
  }

  /** there and back, or one way: the legs are planned again, each keeping what was typed on it */
  function setRound(r: boolean) {
    const out = intl.filter((f) => f.leg_order === "outbound");
    const back = intl.find((f) => f.leg_order === "inbound");
    const plan: FlightPlan = {
      from: out[0]?.from_airport ?? defaults.from,
      to: out.at(-1)?.to_airport ?? defaults.to,
      go: localDatePart(out[0]?.departure_at) ?? defaults.go,
      back: localDatePart(back?.departure_at) ?? defaults.back,
      round: r,
    };
    onChange(planInternational(data, lookups.airports, plan));
  }

  if (!data.scope.flights_intl) return null;
  if (booking.later_intl) {
    return (
      <p className="flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-[#e7cf97] bg-[#fffaf0] px-3 py-2 text-[12px] font-bold text-[#a86a10]">
        {tx("laterLine", { part: tx("laterIntl") })}
        <button
          type="button"
          onClick={() => onChange({ flight_booking: { ...booking, later_intl: undefined } })}
          className="ms-auto text-[11.5px] font-bold text-[#185045] underline-offset-2 hover:underline"
        >
          {tx("undoLater")}
        </button>
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" className="inline-flex rounded-[8px] border border-[#cfe0d9] bg-white p-0.5">
          {([true, false] as const).map((r) => (
            <button
              key={String(r)}
              type="button"
              role="radio"
              aria-checked={round === r}
              onClick={() => setRound(r)}
              className={`h-7 rounded-[6px] px-3 text-[11.5px] font-bold ${round === r ? "bg-[#185045] text-white" : "text-[#557d78]"}`}
            >
              {tx(r ? "roundTrip" : "oneWay")}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange({ flight_booking: { ...booking, later_intl: true } })}
          className={`${basicField} ms-auto w-auto px-3 font-bold`}
        >
          {tx("later")}
        </button>
      </div>

      <div className="space-y-2">
        {intl.map((leg) => (
          <LegRow
            key={leg.id}
            leg={leg}
            name={tx(leg.leg_order === "inbound" ? "planBack" : "planGo")}
            items={leg.leg_order === "inbound" ? { from: dest, to: home } : { from: home, to: dest }}
            airports={lookups.airports}
            airlines={lookups.airlines}
            canFetch={canFetch}
            onEdit={(change) => edit(leg.id ?? "", change)}
            onHit={(h) => hit(leg.id ?? "", h)}
          />
        ))}
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-[#DCE9E5] pt-2">
          <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#557d78]">
            {t("pg.cabin")}
            <select
              aria-label={t("pg.cabin")}
              value={booking.cabin}
              onChange={(e) => {
                const cabin = e.target.value;
                // a new cabin goes on every international leg still in the booking's cabin — a leg given its own keeps it
                onChange({
                  flight_booking: { ...booking, cabin },
                  flights: data.flights.map((f) => (f.leg_order !== "internal" && (!f.cabin_class || f.cabin_class === booking.cabin) ? { ...f, cabin_class: cabin } : f)),
                });
              }}
              className={`${basicField} w-auto px-2`}
            >
              <CabinOptions value={booking.cabin} />
            </select>
          </label>
          <input
            type="number" inputMode="decimal"
            min={0}
            dir="ltr"
            aria-label={tx("planPrice")}
            placeholder={tx("planPrice")}
            value={booking.intl_price ?? ""}
            onChange={(e) => onChange({ flight_booking: { ...withTypedTotal(booking, "intl", typedNumber(e.target)), intl_currency: booking.intl_currency || "SAR" } })}
            className={`${basicField} tv-tnum w-64 max-w-full text-center`}
          />
          <span className="text-[11px] font-semibold text-tv-text-faint">{canFetch ? tx("fetchHint") : null}</span>
        </div>
        <FlightFare booking={booking} kind="intl" trip={data.trip} field={basicField} onChange={(flight_booking) => onChange({ flight_booking })} />
      </div>
    </div>
  );
}
