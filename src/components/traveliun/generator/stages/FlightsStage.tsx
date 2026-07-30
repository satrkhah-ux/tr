"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Clock, Globe2, Loader2, Plane, Plus, RotateCcw, Search, TimerReset } from "lucide-react";
import { DirText } from "@/components/DirText";
import { getAssistantAvailability, lookupFlightNumber } from "@/lib/data/itinerary-actions";
import type { FlightLookupHit } from "@/lib/providers/flight-lookup";
import {
  deriveCityDates,
  type DraftFlight,
  type LookupAirport,
} from "@/lib/offer/draft-types";
import { buildJourneys, formatWaitAr, type JourneyLeg } from "@/lib/offer/journey";
import {
  autoDepartureDate,
  flightTiming,
  formatDurationAr,
  itineraryStartDate,
  localDatePart,
  syncDepartureDates,
  withDatePart,
} from "@/lib/offer/schedule";
import type { TranslationKey } from "@/lib/i18n";
import type { FlightLegOrder } from "@/lib/types";
import { parseFlightNumber } from "@/lib/offer/flight-number";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import {
  addButtonClass,
  fieldClass,
  removeButtonClass,
  sectionClass,
  type StageFormProps,
} from "../stage-props";

/** International legs the agent can pick between (domestic is its own section). */
const INTL_LEG_ORDERS: FlightLegOrder[] = ["outbound", "inbound"];

const LEG_LABEL_KEYS: Record<FlightLegOrder, TranslationKey> = {
  outbound: "pg.leg.outbound",
  inbound: "pg.leg.inbound",
  internal: "pg.leg.internal",
};

/** Domestic = the `internal` leg: a hop INSIDE the destination country. */
const isDomestic = (f: DraftFlight) => f.leg_order === "internal";

const rowLabelClass = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

/** The datalist display value for an airport ("name (CODE)"). */
function airportDisplay(a: LookupAirport): string {
  return a.code ? `${a.name} (${a.code})` : a.name;
}

/**
 * Resolve the IANA timezone for a typed airport value. Matches the datalist
 * display first, then falls back to the (CODE) in parentheses. null for a
 * free-typed airport we don't know — the duration then stays unknown (guarded),
 * never guessed from the server/browser tz.
 */
function resolveTz(value: string, airports: LookupAirport[]): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const exact = airports.find((a) => airportDisplay(a) === trimmed);
  if (exact) return exact.timezone;
  const codeMatch = trimmed.match(/\(([A-Za-z]{3})\)/);
  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    const byCode = airports.find((a) => (a.code ?? "").toUpperCase() === code);
    if (byCode) return byCode.timezone;
  }
  return null;
}

function emptyFlight(legOrder: FlightLegOrder): DraftFlight {
  return {
    airline: "",
    airline_iata: "",
    flight_no: "",
    from_airport: "",
    to_airport: "",
    departure_at: null,
    arrival_at: null,
    from_tz: null,
    to_tz: null,
    date_user_set: false,
    cabin_class: "",
    baggage_allowance: "",
    baggage_kg: null,
    baggage_pieces: null,
    cabin_baggage_kg: null,
    leg_order: legOrder,
  };
}

type RowHandlers = {
  updateRow: (index: number, slice: Partial<DraftFlight>) => void;
  resolveCarrier: (index: number, flightNo: string) => void;
  setAirport: (index: number, field: "from_airport" | "to_airport", value: string) => void;
  setDeparture: (index: number, raw: string) => void;
  restoreAuto: (index: number) => void;
  removeRow: (index: number) => void;
  applyLookup: (index: number, hit: FlightLookupHit) => void;
};

/** "HH:mm" out of a "YYYY-MM-DDTHH:mm" wall clock. */
function timePart(value: string | null): string | null {
  return value && value.length >= 16 ? value.slice(11, 16) : null;
}

/** Whole days between two wall-clock stamps (an overnight leg is +1). */
function dayOffsetBetween(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(Math.round((b - a) / 86_400_000), 0);
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Prefer OUR airport row for a looked-up IATA code — it carries the IANA zone
 * the duration maths needs. Fall back to the provider's own name so the field
 * is never left blank.
 */
function airportValueFor(iata: string, providerName: string, airports: LookupAirport[]): string {
  const known = airports.find((a) => (a.code ?? "").toUpperCase() === iata.toUpperCase());
  if (known) return airportDisplay(known);
  const name = providerName.trim();
  return iata ? (name ? `${name} (${iata})` : iata) : name;
}

/**
 * Stage 5 — flight legs, timezone-correct, split into TWO sections:
 *   • international (outbound / inbound) — always relevant;
 *   • domestic (internal hops) — only some destinations have them, so the
 *     section is clearly optional and starts empty.
 * Departure dates are trip-driven (outbound → trip start, inbound → trip end)
 * until the agent pins one; times are LOCAL at each airport and the duration /
 * day-offset come from the airports' IANA zones. Any flight change re-derives
 * the hotel check-in chain, all in ONE patch.
 */
export function FlightsStage({ data, patch, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const flights = data.flights;
  const airports = lookups.airports;
  const airlines = lookups.airlines;

  /** Persist flights + keep the trip-driven departure dates and hotel chain in sync. */
  function commit(next: DraftFlight[]) {
    const synced = syncDepartureDates(data.trip, next);
    patch({
      flights: synced,
      cities: deriveCityDates(itineraryStartDate(data.trip, synced), data.cities),
    });
  }

  function updateRow(index: number, slice: Partial<DraftFlight>) {
    commit(flights.map((f, i) => (i === index ? { ...f, ...slice } : f)));
  }

  function setAirport(index: number, field: "from_airport" | "to_airport", value: string) {
    const tzField = field === "from_airport" ? "from_tz" : "to_tz";
    updateRow(index, { [field]: value, [tzField]: resolveTz(value, airports) } as Partial<DraftFlight>);
  }

  function setDeparture(index: number, raw: string) {
    const value = raw === "" ? null : raw;
    const flight = flights[index];
    const auto = autoDepartureDate(data.trip, flight.leg_order);
    const newDate = localDatePart(value);
    // Diverging the DATE from the trip-driven date pins it ("user-set"); snapping
    // it back to the auto date (or clearing it) re-enables auto-sync.
    const userSet = newDate !== null && newDate !== auto;
    updateRow(index, { departure_at: value, date_user_set: userSet });
  }

  function restoreAuto(index: number) {
    const flight = flights[index];
    const auto = autoDepartureDate(data.trip, flight.leg_order);
    updateRow(index, { date_user_set: false, departure_at: withDatePart(flight.departure_at, auto) });
  }

  /** International: first leg defaults to outbound, the next to inbound. */
  function addInternational() {
    const hasOutbound = flights.some((f) => f.leg_order === "outbound");
    commit([...flights, emptyFlight(hasOutbound ? "inbound" : "outbound")]);
  }

  function addDomestic() {
    commit([...flights, emptyFlight("internal")]);
  }

  function removeRow(index: number) {
    commit(flights.filter((_, i) => i !== index));
  }

  /**
   * Apply a looked-up route to a row. The provider's schedule is from ANOTHER
   * date, so only the TIME OF DAY is taken — the trip's own departure date is
   * kept (and the arrival date follows the provider's overnight offset). This
   * is why the agent still confirms: real times, our dates.
   */
  /**
   * The smart bit, and it costs nothing: the flight number already contains the
   * carrier. «SV820» → SV → «الخطوط السعودية» + its mark, with no API call, no key
   * and no waiting. A name the agent typed themselves is never overwritten — only
   * an empty field, or one this same resolution filled.
   */
  function resolveCarrier(index: number, flightNo: string) {
    const parsed = parseFlightNumber(flightNo);
    const current = flights[index];
    const match = parsed
      ? airlines.find((a) => a.iata === parsed.carrier) ??
        airlines.find((a) => a.iata === parsed.carrier.slice(0, 2))
      : null;

    const patch: Partial<DraftFlight> = { flight_no: flightNo };
    if (!match) {
      updateRow(index, patch);
      return;
    }
    patch.airline_iata = match.iata;
    const typedByHand = current.airline.trim() && current.airline !== previousName(current.airline_iata);
    if (!typedByHand) patch.airline = match.name;
    updateRow(index, patch);
  }

  /** the name this resolution would have written for a designator, if any. */
  function previousName(iata: string): string {
    return airlines.find((a) => a.iata === iata)?.name ?? "";
  }

  function applyLookup(index: number, hit: FlightLookupHit) {
    const flight = flights[index];
    const from_airport = airportValueFor(hit.from_iata, hit.from_airport, airports);
    const to_airport = airportValueFor(hit.to_iata, hit.to_airport, airports);
    const depDate = localDatePart(flight.departure_at) ?? autoDepartureDate(data.trip, flight.leg_order);
    const depTime = timePart(hit.departure_at);
    const arrTime = timePart(hit.arrival_at);
    const offset = dayOffsetBetween(hit.departure_at, hit.arrival_at);

    const parsed = parseFlightNumber(hit.flight_iata || flight.flight_no);
    const carrier = parsed ? airlines.find((a) => a.iata === parsed.carrier) : null;

    updateRow(index, {
      // our own row's Arabic name wins over the provider's Latin one
      airline: carrier?.name || hit.airline || flight.airline,
      airline_iata: carrier?.iata ?? flight.airline_iata,
      flight_no: hit.flight_iata || flight.flight_no,
      from_airport,
      to_airport,
      // our own airport rows win for the zone; the provider's is the fallback
      from_tz: resolveTz(from_airport, airports) ?? hit.from_tz,
      to_tz: resolveTz(to_airport, airports) ?? hit.to_tz,
      departure_at: depDate && depTime ? `${depDate}T${depTime}` : flight.departure_at,
      arrival_at: depDate && arrTime ? `${addDaysIso(depDate, offset)}T${arrTime}` : flight.arrival_at,
    });
  }

  const handlers: RowHandlers = { updateRow, resolveCarrier, setAirport, setDeparture, restoreAuto, removeRow, applyLookup };

  // Rows keep their ORIGINAL index so edits/removals stay correct after grouping.
  const rows = flights.map((flight, index) => ({ flight, index }));
  const international = rows.filter((r) => !isDomestic(r.flight));
  const domestic = rows.filter((r) => isDomestic(r.flight));

  // Grouped into chains so a transit reads as ONE journey with a wait in the
  // middle, rather than two flights that happen to share an offer.
  const journeys = buildJourneys(flights);
  const intlJourneys = journeys.filter((j) => j.leg_order !== "internal");
  const domesticJourney = journeys.find((j) => j.leg_order === "internal") ?? null;
  /** identity lookup — the array index is the edit handle everything else uses. */
  const indexOf = (flight: DraftFlight) => flights.indexOf(flight);

  return (
    <section className={sectionClass}>
      <h2 className="mb-4 text-base font-extrabold text-[#003c3a]">{t("pg.flightsTitle")}</h2>

      <datalist id="pg-airports">
        {airports.map((airport) => (
          <option key={airport.id} value={airportDisplay(airport)} />
        ))}
      </datalist>

      {/* ── international (outbound / inbound) ──────────────────────────────── */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-[13.5px] font-extrabold text-[#0f3d38]">
          <Globe2 className="size-4 text-[#185045]" />
          {t("pg.flightsIntl")}
        </h3>
        <span className="rounded-full bg-[#eef4f1] px-2 py-0.5 text-[10.5px] font-bold text-[#557d78]">
          {t("pg.flightsIntlHint")}
        </span>
      </div>

      {international.length === 0 ? (
        <p className="mb-3 rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[13px] text-[#93aaa3]">
          {t("pg.noFlightsYet")}
        </p>
      ) : (
        <div className="mb-3 space-y-4">
          {intlJourneys.map((journey) => (
            <div key={journey.leg_order} className="rounded-[12px] border border-[#e2ebe7] bg-[#fbfdfc] p-2.5">
              <JourneyHeader journey={journey} />
              <div className="space-y-2">
                {journey.legs.map((jl) => {
                  const index = indexOf(jl.flight);
                  return (
                    <div key={index}>
                      {/* the wait BEFORE this leg — the thing a client asks about
                          and the only number here the eye cannot check, because
                          the two clocks are in different timezones */}
                      <LayoverBar leg={jl} airport={jl.flight.from_airport} />
                      <FlightRow
                        flight={jl.flight}
                        index={index}
                        segment={journey.isTransit ? jl.segment : undefined}
                        showLegSelect
                        handlers={handlers}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={addInternational} className={addButtonClass}>
        <Plus className="size-4" />
        {t("pg.addFlightIntl")}
      </button>

      {/* ── domestic (internal hops) — optional, destination-dependent ──────── */}
      <div className="mt-6 border-t border-[#e7f0ec] pt-5">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-2 text-[13.5px] font-extrabold text-[#0f3d38]">
            <Plane className="size-4 text-[#0e9bb5]" />
            {t("pg.flightsDomestic")}
          </h3>
          <span className="rounded-full bg-[#e8f6fa] px-2 py-0.5 text-[10.5px] font-bold text-[#0b6d80]">
            {t("pg.flightsDomesticHint")}
          </span>
        </div>

        {domestic.length === 0 ? (
          <p className="mb-3 rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[13px] text-[#93aaa3]">
            {t("pg.noDomesticFlights")}
          </p>
        ) : (
          <div className="mb-3 space-y-2">
            {domesticJourney?.legs.map((jl) => {
              const index = indexOf(jl.flight);
              return (
                <div key={index}>
                  <LayoverBar leg={jl} airport={jl.flight.from_airport} />
                  <FlightRow
                    flight={jl.flight}
                    index={index}
                    segment={domesticJourney.isTransit ? jl.segment : undefined}
                    handlers={handlers}
                  />
                </div>
              );
            })}
          </div>
        )}

        <button type="button" onClick={addDomestic} className={addButtonClass}>
          <Plus className="size-4" />
          {t("pg.addFlightDomestic")}
        </button>
      </div>
    </section>
  );
}

/**
 * «جلب بيانات الرحلة» — look the typed flight number up and offer the published
 * routes as candidates. Nothing is applied automatically: the agent picks the
 * route, and the panel states which date the schedule was observed on so the
 * times get checked rather than trusted blindly.
 *
 * The button is hidden entirely when the provider is not configured — an agent
 * should never be offered a control that cannot work.
 */
function FlightLookup({ flightNo, onPick }: { flightNo: string; onPick: (hit: FlightLookupHit) => void }) {
  const { t } = useTraveliunUI();
  const [enabled, setEnabled] = useState(false);
  const [pending, startTransition] = useTransition();
  const [hits, setHits] = useState<FlightLookupHit[] | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);

  useEffect(() => {
    void getAssistantAvailability().then((a) => setEnabled(a.flightLookup));
  }, []);

  if (!enabled) return null;

  function run() {
    setError(null);
    setHits(null);
    startTransition(async () => {
      const result = await lookupFlightNumber(flightNo);
      if (result.ok) setHits(result.hits);
      else setError(result.error);
    });
  }

  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={pending || !flightNo.trim()}
        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border border-[#cfe0d9] bg-white px-2.5 text-[11.5px] font-bold text-[#185045] transition-colors hover:bg-[#f0f7f4] disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
        {t("pg.flightLookup.button")}
      </button>
      {error ? <span className="text-[10.5px] font-bold text-[#c43d3d]">{t(error)}</span> : null}
      {hits?.map((hit, i) => (
        <button
          key={i}
          type="button"
          onClick={() => {
            onPick(hit);
            setHits(null);
          }}
          className="grid gap-0.5 rounded-[8px] border border-[#cfe0d9] bg-[#f4f8f6] px-2.5 py-1.5 text-start transition-colors hover:bg-[#e7f2ec]"
        >
          <span className="tv-tnum text-[11.5px] font-extrabold text-[#185045]">
            <DirText dir="ltr">{`${hit.from_iata} → ${hit.to_iata}`}</DirText>
            {hit.departure_at ? (
              <span className="ms-1.5 font-bold text-[#557d78]">
                <DirText dir="ltr">{`${timePart(hit.departure_at) ?? ""}–${timePart(hit.arrival_at) ?? ""}`}</DirText>
              </span>
            ) : null}
          </span>
          <span className="text-[10px] font-bold text-[#93aaa3]">
            {hit.airline}
            {hit.schedule_date ? ` · ${t("pg.flightLookup.scheduleFrom", { date: hit.schedule_date })}` : ""}
          </span>
        </button>
      ))}
    </div>
  );
}

/** «الذهاب · ترانزيت · إجمالي ١٠ س ٣٠ د» — the chain at a glance. */
function JourneyHeader({ journey }: { journey: ReturnType<typeof buildJourneys>[number] }) {
  const { t } = useTraveliunUI();
  const total = formatDurationAr(journey.totalMinutes);
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
      <span className="text-[12.5px] font-extrabold text-[#0f3d38]">{t(LEG_LABEL_KEYS[journey.leg_order])}</span>
      {journey.isTransit ? (
        <span className="rounded-full bg-[#eaf1ff] px-2 py-0.5 text-[10.5px] font-extrabold text-[#2b57c4]">
          {t("pg.transit")}
        </span>
      ) : (
        <span className="rounded-full bg-[#e9f7f0] px-2 py-0.5 text-[10.5px] font-bold text-[#0f7a52]">
          {t("pg.direct")}
        </span>
      )}
      {total ? (
        <span className="tv-tnum inline-flex items-center gap-1 rounded-full bg-[#eef4f1] px-2 py-0.5 text-[10.5px] font-bold text-[#557d78]">
          <Clock className="size-3" />
          {t("pg.journeyTotal")} <DirText dir="ltr">{total}</DirText>
        </span>
      ) : null}
    </div>
  );
}

/**
 * The wait at the transit airport.
 *
 * Nothing is drawn for the first leg of a chain. When the zones are unknown the
 * bar says so rather than showing a number computed from wall clocks that belong
 * to different timezones — a wrong layover is what makes someone book a
 * connection they cannot make.
 */
function LayoverBar({ leg, airport }: { leg: JourneyLeg<DraftFlight>; airport: string }) {
  const { t } = useTraveliunUI();
  if (leg.segment === 1) return null;

  const wait = formatWaitAr(leg.layoverMinutes);
  const impossible = leg.layoverMinutes !== null && leg.layoverMinutes < 0;
  const tone = impossible || leg.layoverTooShort
    ? "border-[#f4c9d4] bg-[#fdeef2] text-[#c22850]"
    : leg.layoverLong
      ? "border-[#f2e2b4] bg-[#fff8e8] text-[#a86a10]"
      : "border-[#d6eadf] bg-[#f2fbf6] text-[#0f7a52]";

  return (
    <div className={`my-1.5 flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-2 text-[11.5px] font-bold ${tone}`}>
      <TimerReset className="size-3.5" />
      <span>{t("pg.layoverAt", { airport: airport || "—" })}</span>
      {impossible ? (
        <span>{t("pg.layoverImpossible")}</span>
      ) : wait ? (
        <>
          <DirText dir="ltr">
            <span className="tv-tnum">{wait}</span>
          </DirText>
          {leg.layoverTooShort ? <span>· {t("pg.layoverShort")}</span> : null}
          {leg.layoverLong ? <span>· {t("pg.layoverLong")}</span> : null}
        </>
      ) : (
        <span>{t("pg.layoverUnknown")}</span>
      )}
    </div>
  );
}

/** One flight leg. `showLegSelect` is on for international rows (outbound/inbound). */
function FlightRow({
  flight,
  index,
  segment,
  showLegSelect = false,
  handlers,
}: {
  flight: DraftFlight;
  index: number;
  /** 1-based position in its chain; undefined for a direct journey. */
  segment?: number;
  showLegSelect?: boolean;
  handlers: RowHandlers;
}) {
  const { t } = useTraveliunUI();
  const { updateRow, resolveCarrier, setAirport, setDeparture, restoreAuto, removeRow, applyLookup } = handlers;
  const timing = flightTiming(flight);
  const duration = formatDurationAr(timing.durationMinutes);
  const bothDatesSet = Boolean(flight.departure_at && flight.arrival_at);
  const dayUnit = timing.dayOffset === 1 ? t("pg.dayUnitOne") : t("pg.dayUnitMany");

  return (
    <div className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
      {segment ? (
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11px] font-extrabold text-[#185045]">
          {t("pg.segmentN", { n: segment })}
        </p>
      ) : null}
      <div className="grid items-start gap-3 md:grid-cols-2 lg:grid-cols-3">
        {showLegSelect ? (
          <label className={rowLabelClass}>
            {t("pg.legOrder")}
            <select
              value={flight.leg_order}
              onChange={(e) => updateRow(index, { leg_order: e.target.value as FlightLegOrder })}
              className={fieldClass}
            >
              {INTL_LEG_ORDERS.map((leg) => (
                <option key={leg} value={leg}>
                  {t(LEG_LABEL_KEYS[leg])}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={rowLabelClass}>
          {t("pg.airline")}
          <input
            value={flight.airline}
            onChange={(e) => updateRow(index, { airline: e.target.value })}
            className={fieldClass}
          />
        </label>
        <div className={rowLabelClass}>
          <label className="grid gap-1.5">
            {t("pg.flightNo")}
            <input
              dir="ltr"
              value={flight.flight_no}
              onChange={(e) => resolveCarrier(index, e.target.value)}
              placeholder={t("pg.flightLookup.placeholder")}
              className={`${fieldClass} tv-tnum text-start`}
            />
          </label>
          <FlightLookup
            flightNo={flight.flight_no}
            onPick={(hit) => applyLookup(index, hit)}
          />
        </div>
        <label className={rowLabelClass}>
          {t("pg.fromAirport")}
          <input
            list="pg-airports"
            value={flight.from_airport}
            onChange={(e) => setAirport(index, "from_airport", e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className={rowLabelClass}>
          {t("pg.toAirport")}
          <input
            list="pg-airports"
            value={flight.to_airport}
            onChange={(e) => setAirport(index, "to_airport", e.target.value)}
            className={fieldClass}
          />
        </label>

        <label className={rowLabelClass}>
          {t("pg.departureAt")}
          <input
            type="datetime-local"
            dir="ltr"
            value={flight.departure_at ?? ""}
            onChange={(e) => setDeparture(index, e.target.value)}
            className={`${fieldClass} tv-tnum`}
          />
          <span className="text-[10.5px] font-semibold text-[#93aaa3]">
            {flight.from_tz ? t("pg.localTimeAt", { tz: flight.from_tz }) : t("pg.localTimePick")}
          </span>
          {flight.date_user_set ? (
            <span className="flex items-center gap-1.5 text-[10.5px] font-bold text-[#a86a10]">
              {t("pg.dateManualHint")}
              <button
                type="button"
                onClick={() => restoreAuto(index)}
                className="inline-flex items-center gap-1 rounded-md bg-[#fff2d6] px-1.5 py-0.5 font-extrabold text-[#8a5a0c] hover:bg-[#ffe9bd]"
              >
                <RotateCcw className="size-3" />
                {t("pg.restoreAutoDate")}
              </button>
            </span>
          ) : null}
        </label>
        <label className={rowLabelClass}>
          {t("pg.arrivalAt")}
          <input
            type="datetime-local"
            dir="ltr"
            value={flight.arrival_at ?? ""}
            onChange={(e) => updateRow(index, { arrival_at: e.target.value === "" ? null : e.target.value })}
            className={`${fieldClass} tv-tnum`}
          />
          <span className="text-[10.5px] font-semibold text-[#93aaa3]">
            {flight.to_tz ? t("pg.localTimeAt", { tz: flight.to_tz }) : t("pg.localTimePick")}
          </span>
        </label>

        <label className={rowLabelClass}>
          {t("pg.cabin")}
          <input
            value={flight.cabin_class}
            onChange={(e) => updateRow(index, { cabin_class: e.target.value })}
            className={fieldClass}
          />
        </label>
        {/* two numbers, not one string: an airline enforces the weight AND the
            piece count, and "30 kg" alone leaves the agent guessing which. */}
        <div className="grid grid-cols-3 gap-2">
          <label className={rowLabelClass}>
            {t("pg.baggageKg")}
            <input
              type="number" min={0} dir="ltr"
              value={flight.baggage_kg ?? ""}
              onChange={(e) => updateRow(index, { baggage_kg: e.target.value === "" ? null : Number(e.target.value) })}
              className={`${fieldClass} tv-tnum text-center`}
            />
          </label>
          <label className={rowLabelClass}>
            {t("pg.baggagePieces")}
            <input
              type="number" min={0} dir="ltr"
              value={flight.baggage_pieces ?? ""}
              onChange={(e) => updateRow(index, { baggage_pieces: e.target.value === "" ? null : Number(e.target.value) })}
              className={`${fieldClass} tv-tnum text-center`}
            />
          </label>
          <label className={rowLabelClass}>
            {t("pg.cabinBaggageKg")}
            <input
              type="number" min={0} dir="ltr"
              value={flight.cabin_baggage_kg ?? ""}
              onChange={(e) => updateRow(index, { cabin_baggage_kg: e.target.value === "" ? null : Number(e.target.value) })}
              className={`${fieldClass} tv-tnum text-center`}
            />
          </label>
        </div>
      </div>

      {/* timing footer — duration, +N day badge, arrival-before-departure guard */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#e7f0ec] pt-3">
        {timing.arrivalBeforeDeparture ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fdeef2] px-2.5 py-1 text-[11.5px] font-bold text-[#c22850]">
            <AlertTriangle className="size-3.5" />
            {t("pg.flightArrivalBeforeDeparture")}
          </span>
        ) : duration ? (
          <>
            <span className="tv-tnum inline-flex items-center gap-1.5 rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11.5px] font-bold text-[#185045]">
              {t("pg.flightDuration")}
              {" · "}
              <DirText dir="ltr">{duration}</DirText>
            </span>
            {timing.dayOffset > 0 ? (
              <span className="tv-tnum inline-flex items-center gap-1 rounded-full bg-[#eaf1ff] px-2.5 py-1 text-[11.5px] font-extrabold text-[#2b57c4]">
                <DirText dir="ltr">{`+${timing.dayOffset}`}</DirText>
                {dayUnit}
              </span>
            ) : null}
          </>
        ) : bothDatesSet ? (
          <span className="text-[11px] font-semibold text-[#93aaa3]">{t("pg.durationNeedsAirports")}</span>
        ) : null}
        <button type="button" onClick={() => removeRow(index)} className={`${removeButtonClass} ms-auto`}>
          {t("pg.removeRow")}
        </button>
      </div>
    </div>
  );
}
