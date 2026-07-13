"use client";

import { AlertTriangle, Plus, RotateCcw } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  deriveCityDates,
  type DraftFlight,
  type LookupAirport,
} from "@/lib/offer/draft-types";
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
import { useTraveliunUI } from "../../TraveliunUIProvider";
import {
  addButtonClass,
  fieldClass,
  removeButtonClass,
  sectionClass,
  type StageFormProps,
} from "../stage-props";

const LEG_ORDERS: FlightLegOrder[] = ["outbound", "inbound", "internal"];

const LEG_LABEL_KEYS: Record<FlightLegOrder, TranslationKey> = {
  outbound: "pg.leg.outbound",
  inbound: "pg.leg.inbound",
  internal: "pg.leg.internal",
};

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
    leg_order: legOrder,
  };
}

/**
 * Stage 5 — flight legs, timezone-correct. Departure dates are trip-driven
 * (outbound → trip start, inbound → trip end) until the agent pins one; times
 * are LOCAL at each airport and the duration/day-offset are computed from the
 * airports' IANA zones. Any flight change re-derives the hotel check-in chain
 * (hotel dates follow the itinerary), all in ONE patch.
 */
export function FlightsStage({ data, patch, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const flights = data.flights;
  const airports = lookups.airports;

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

  function addRow() {
    commit([...flights, emptyFlight(flights.length === 0 ? "outbound" : "inbound")]);
  }

  function removeRow(index: number) {
    commit(flights.filter((_, i) => i !== index));
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-4 text-base font-extrabold text-[#003c3a]">{t("pg.flightsTitle")}</h2>

      <datalist id="pg-airports">
        {airports.map((airport) => (
          <option key={airport.id} value={airportDisplay(airport)} />
        ))}
      </datalist>

      {flights.length === 0 ? (
        <p className="mb-4 rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#93aaa3]">
          {t("pg.noFlightsYet")}
        </p>
      ) : (
        <div className="mb-4 space-y-3">
          {flights.map((flight, index) => {
            const timing = flightTiming(flight);
            const duration = formatDurationAr(timing.durationMinutes);
            const bothDatesSet = Boolean(flight.departure_at && flight.arrival_at);
            const dayUnit = timing.dayOffset === 1 ? t("pg.dayUnitOne") : t("pg.dayUnitMany");

            return (
              <div
                key={index}
                className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3"
              >
                <div className="grid items-start gap-3 md:grid-cols-2 lg:grid-cols-3">
                  <label className={rowLabelClass}>
                    {t("pg.legOrder")}
                    <select
                      value={flight.leg_order}
                      onChange={(e) => updateRow(index, { leg_order: e.target.value as FlightLegOrder })}
                      className={fieldClass}
                    >
                      {LEG_ORDERS.map((leg) => (
                        <option key={leg} value={leg}>
                          {t(LEG_LABEL_KEYS[leg])}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={rowLabelClass}>
                    {t("pg.airline")}
                    <input
                      value={flight.airline}
                      onChange={(e) => updateRow(index, { airline: e.target.value })}
                      className={fieldClass}
                    />
                  </label>
                  <label className={rowLabelClass}>
                    {t("pg.flightNo")}
                    <input
                      dir="ltr"
                      value={flight.flight_no}
                      onChange={(e) => updateRow(index, { flight_no: e.target.value })}
                      className={`${fieldClass} tv-tnum text-start`}
                    />
                  </label>
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
                  <div />

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
                  <div />

                  <label className={rowLabelClass}>
                    {t("pg.cabin")}
                    <input
                      value={flight.cabin_class}
                      onChange={(e) => updateRow(index, { cabin_class: e.target.value })}
                      className={fieldClass}
                    />
                  </label>
                  <label className={rowLabelClass}>
                    {t("pg.baggage")}
                    <input
                      value={flight.baggage_allowance}
                      onChange={(e) => updateRow(index, { baggage_allowance: e.target.value })}
                      className={fieldClass}
                    />
                  </label>
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
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className={`${removeButtonClass} ms-auto`}
                  >
                    {t("pg.removeRow")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button type="button" onClick={addRow} className={addButtonClass}>
        <Plus className="size-4" />
        {t("pg.addFlight")}
      </button>
    </section>
  );
}
