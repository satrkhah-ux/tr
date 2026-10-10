"use client";

import { Clock, Luggage } from "lucide-react";
import { deriveCityDates, findLookupCountry, type DraftTrip } from "@/lib/offer/draft-types";
import { itineraryStartDate, syncDepartureDates } from "@/lib/offer/schedule";
import { describeOffsetAr, offsetFromHome } from "@/lib/offer/timezones";
import { FieldIssue, useFieldRing } from "../FieldIssue";
import { ScopeTiles } from "../ScopeTiles";
import { TransportBlock } from "../TransportBlock";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass, labelClass, sectionClass, type StageFormProps } from "../stage-props";

const DAY_MS = 86_400_000;

/** Whole nights between two ISO dates (>= 0), or null when either is missing/invalid. */
function nightsBetween(arrival: string | null, departure: string | null): number | null {
  if (!arrival || !departure) return null;
  const start = Date.parse(`${arrival}T00:00:00Z`);
  const end = Date.parse(`${departure}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(Math.round((end - start) / DAY_MS), 0);
}

/** ISO date + N days, in UTC so a DST change can never shift the calendar day. */
function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Stage 2 — trip frame: country, destination, dates, duration and travelers.
 * Edits ONLY data.trip — with one contract exception: when the arrival date
 * moves, the city check-in/check-out chain is re-derived in the SAME patch.
 */
export function TripStage({ data, patch, lookups }: StageFormProps) {
  const countryRing = useFieldRing("trip.country");
  const arrivalRing = useFieldRing("trip.arrival_date");
  const tzNote = describeOffsetAr(
    offsetFromHome(findLookupCountry(lookups.countries, data.trip.country)?.timezone ?? null, data.trip.arrival_date),
  );
  const { t } = useTraveliunUI();
  const trip = data.trip;

  function update(slice: Partial<DraftTrip>) {
    patch({ trip: { ...trip, ...slice } });
  }

  function setCountry(nextCountry: string) {
    const slice: Partial<DraftTrip> = { country: nextCountry };
    if (!trip.destination.trim() || trip.destination === trip.country) {
      slice.destination = nextCountry;
    }
    update(slice);
  }

  /**
   * Commit a trip slice and re-derive everything that hangs off the dates.
   *
   * Trip dates drive the flight departure dates (outbound → arrival, inbound →
   * departure) unless the agent has pinned a leg; hotel check-ins then follow
   * the itinerary start (the outbound flight's local landing date, or the trip
   * arrival when no flight is set yet). All folded into ONE patch.
   */
  function commit(slice: Partial<DraftTrip>) {
    const nextTrip = { ...trip, ...slice };
    const flights = syncDepartureDates(nextTrip, data.flights);
    patch({
      trip: nextTrip,
      flights,
      cities: deriveCityDates(itineraryStartDate(nextTrip, flights), data.cities),
    });
  }

  /**
   * Each date/duration field has ONE consequence, so the three of them never
   * fight each other:
   *   arrival   → the trip MOVES, its length is kept  (departure follows)
   *   duration  → the trip STRETCHES from the arrival (departure follows)
   *   departure → the length is re-measured           (days/nights follow)
   * Arrival is the anchor: an agent who types "8 days" expects the return date
   * to appear, not the start date to jump.
   */
  function setArrival(value: string) {
    const arrival = value || null;
    // Keep the length when there is one; otherwise measure it from the dates.
    if (arrival && trip.nights > 0) {
      commit({ arrival_date: arrival, departure_date: addDaysIso(arrival, trip.nights) });
      return;
    }
    const nights = nightsBetween(arrival, trip.departure_date);
    commit(nights === null ? { arrival_date: arrival } : { arrival_date: arrival, nights, days: nights + 1 });
  }

  function setDeparture(value: string) {
    const departure = value || null;
    const nights = nightsBetween(trip.arrival_date, departure);
    commit(nights === null ? { departure_date: departure } : { departure_date: departure, nights, days: nights + 1 });
  }

  /** Duration typed → the departure date is written/shifted to match. */
  function setDuration(days: number, nights: number) {
    const slice: Partial<DraftTrip> = { days, nights };
    if (trip.arrival_date) slice.departure_date = addDaysIso(trip.arrival_date, nights);
    commit(slice);
  }

  function setDays(value: number) {
    const days = Math.max(value, 0);
    setDuration(days, Math.max(days - 1, 0));
  }

  function setNights(value: number) {
    const nights = Math.max(value, 0);
    setDuration(nights + 1, nights);
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-1 text-base font-extrabold text-[#003c3a]">{t("pg.tripTitle")}</h2>

      {/*
        What the programme includes, before anything else on this card.

        These seven decide which cards come after — and two of them decide what
        the REST of this card shows: tick «المواصلات» and the vehicles appear
        below, tick a flight and its baggage does. So they are answered while
        the agent is still describing the trip, not on a screen of their own
        that had to be clicked through first.
      */}
      <p className="mb-3 text-[12.5px] font-semibold text-[#93aaa3]">{t("pg.scopeStageHint")}</p>
      <div className="mb-5">
        <ScopeTiles data={data} patch={patch} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          {t("pg.country")}
          <select value={trip.country} onChange={(e) => setCountry(e.target.value)} className={`${fieldClass}${countryRing}`}>
            <option value="">{t("pg.chooseCountry")}</option>
            {lookups.countries.map((country) => (
              <option key={country.id} value={country.name}>{country.name}</option>
            ))}
            {trip.country && !lookups.countries.some((c) => c.name === trip.country) ? (
              <option value={trip.country}>{trip.country}</option>
            ) : null}
          </select>
          <FieldIssue field="trip.country" />
          {/* Computed for the TRIP dates, not stored: 21 of our destinations
              change their offset with daylight saving, so a number on the
              country row would be wrong for half of every year. */}
          {tzNote ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#557d78]">
              <Clock className="size-3.5 text-[#93aaa3]" />
              {tzNote}
            </span>
          ) : null}
        </label>
        <label className={labelClass}>
          {t("pg.destinationLabel")}
          <input
            value={trip.destination}
            onChange={(e) => update({ destination: e.target.value })}
            className={fieldClass}
          />
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <label className={labelClass}>
          {t("pg.arrival")}
          <input
            type="date"
            dir="ltr"
            value={trip.arrival_date ?? ""}
            onChange={(e) => setArrival(e.target.value)}
            className={`${fieldClass} tv-tnum${arrivalRing}`}
          />
          <FieldIssue field="trip.arrival_date" />
        </label>
        <label className={labelClass}>
          {t("pg.departure")}
          <input
            type="date"
            dir="ltr"
            value={trip.departure_date ?? ""}
            onChange={(e) => setDeparture(e.target.value)}
            className={`${fieldClass} tv-tnum`}
          />
        </label>
        <label className={labelClass}>
          {t("pg.days")}
          <input
            type="number"
            min={0}
            dir="ltr"
            value={trip.days}
            onChange={(e) => setDays(Number(e.target.value) || 0)}
            className={`${fieldClass} tv-tnum text-center`}
          />
        </label>
        <label className={labelClass}>
          {t("pg.nightsLabel")}
          <input
            type="number"
            min={0}
            dir="ltr"
            value={trip.nights}
            onChange={(e) => setNights(Number(e.target.value) || 0)}
            className={`${fieldClass} tv-tnum text-center`}
          />
        </label>
      </div>
      <p className="mt-2 text-[11.5px] font-semibold text-[#93aaa3]">{t("pg.daysAuto")}</p>

      {/* Transport belongs HERE, not with the customer: the vehicle and how
          many of them follow from the dates and the cities, and the airport
          pickup is a fact about the journey rather than about the client. */}
      {data.scope.transport ? (
        <div className="mt-5">
          <TransportBlock
            plan={data.transport_plan}
            carTypes={lookups.carTypes}
            cityCount={data.cities.length}
            onChange={(transport_plan) => patch({ transport_plan })}
          />
        </div>
      ) : null}

      {data.scope.flights_intl || data.scope.flights_domestic ? (
        <BaggageBlock data={data} patch={patch} />
      ) : null}
    </section>
  );
}

/**
 * Baggage, answered once for the whole trip.
 *
 * International and domestic are separate because they genuinely differ: a
 * 30 kg international ticket routinely allows 20 on the domestic hop. Every NEW
 * flight row copies these numbers; correcting one leg afterwards keeps the
 * agent's own number, because the row holds a copy and not a live link.
 */
function BaggageBlock({ data, patch }: Pick<StageFormProps, "data" | "patch">) {
  const { t } = useTraveliunUI();
  const trip = data.trip;

  function set(field: keyof DraftTrip, raw: string) {
    const value = raw.trim() === "" ? null : Math.max(Number(raw) || 0, 0);
    patch({ trip: { ...trip, [field]: value } });
  }

  const rows = [
    {
      show: data.scope.flights_intl,
      label: t("pg.baggageIntl"),
      pieces: "baggage_intl_pieces",
      kg: "baggage_intl_kg",
      cabin: "baggage_intl_cabin_kg",
    },
    {
      show: data.scope.flights_domestic,
      label: t("pg.baggageDom"),
      pieces: "baggage_dom_pieces",
      kg: "baggage_dom_kg",
      cabin: "baggage_dom_cabin_kg",
    },
  ] as const;

  return (
    <div className="mt-5 rounded-2xl border border-[#e2ebe7] bg-[#fbfdfc] p-5">
      <h3 className="flex items-center gap-2 text-[14px] font-extrabold text-[#0f3d38]">
        <Luggage className="size-4 text-[#185045]" />
        {t("pg.baggageDefaults")}
      </h3>
      <p className="mt-1 text-[11.5px] font-semibold text-[#93aaa3]">{t("pg.baggageDefaultsHint")}</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {rows.filter((r) => r.show).map((row) => (
          <div key={row.label} className="rounded-[13px] border border-[#cfe0d9] bg-white p-4">
            <p className="mb-3 text-[12.5px] font-extrabold text-[#185045]">{row.label}</p>
            <div className="grid grid-cols-3 gap-2.5">
              {([
                [t("pg.baggagePieces"), row.pieces],
                [t("pg.baggageKg"), row.kg],
                [t("pg.cabinBaggageKg"), row.cabin],
              ] as const).map(([label, field]) => (
                <label key={field} className="grid gap-1 text-[11px] font-bold text-[#557d78]">
                  {label}
                  <input
                    type="number"
                    min={0}
                    dir="ltr"
                    value={trip[field] ?? ""}
                    onChange={(e) => set(field, e.target.value)}
                    className={`${fieldClass} tv-tnum h-10 text-center`}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
