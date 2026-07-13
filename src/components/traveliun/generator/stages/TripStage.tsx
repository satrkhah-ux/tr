"use client";

import { deriveCityDates, type DraftTrip } from "@/lib/offer/draft-types";
import { itineraryStartDate, syncDepartureDates } from "@/lib/offer/schedule";
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

/**
 * Stage 2 — trip frame: country, destination, dates, duration and travelers.
 * Edits ONLY data.trip — with one contract exception: when the arrival date
 * moves, the city check-in/check-out chain is re-derived in the SAME patch.
 */
export function TripStage({ data, patch, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const trip = data.trip;

  function update(slice: Partial<DraftTrip>) {
    patch({ trip: { ...trip, ...slice } });
  }

  /** Fold auto-computed days/nights into a date slice when both dates are set. */
  function withDerivedDuration(slice: Partial<DraftTrip>): Partial<DraftTrip> {
    const arrival = slice.arrival_date !== undefined ? slice.arrival_date : trip.arrival_date;
    const departure = slice.departure_date !== undefined ? slice.departure_date : trip.departure_date;
    const nights = nightsBetween(arrival, departure);
    if (nights === null) return slice;
    return { ...slice, nights, days: nights + 1 };
  }

  function setCountry(nextCountry: string) {
    const slice: Partial<DraftTrip> = { country: nextCountry };
    if (!trip.destination.trim() || trip.destination === trip.country) {
      slice.destination = nextCountry;
    }
    update(slice);
  }

  function setArrival(value: string) {
    // Trip dates drive the flight departure dates (outbound → arrival, inbound →
    // departure) unless the agent has manually pinned a leg. Hotel dates then
    // follow the itinerary start (the outbound flight's local landing date, or
    // the trip arrival when no flight is set yet). All folded into ONE patch.
    const nextTrip = { ...trip, ...withDerivedDuration({ arrival_date: value || null }) };
    const flights = syncDepartureDates(nextTrip, data.flights);
    patch({
      trip: nextTrip,
      flights,
      cities: deriveCityDates(itineraryStartDate(nextTrip, flights), data.cities),
    });
  }

  function setDeparture(value: string) {
    const nextTrip = { ...trip, ...withDerivedDuration({ departure_date: value || null }) };
    const flights = syncDepartureDates(nextTrip, data.flights);
    patch({ trip: nextTrip, flights });
  }

  function setDays(value: number) {
    const days = Math.max(value, 0);
    update({ days, nights: Math.max(days - 1, 0) });
  }

  function setNights(value: number) {
    const nights = Math.max(value, 0);
    update({ nights, days: nights + 1 });
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-4 text-base font-extrabold text-[#003c3a]">{t("pg.tripTitle")}</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          {t("pg.country")}
          <select value={trip.country} onChange={(e) => setCountry(e.target.value)} className={fieldClass}>
            <option value="">{t("pg.chooseCountry")}</option>
            {lookups.countries.map((country) => (
              <option key={country.id} value={country.name}>{country.name}</option>
            ))}
            {trip.country && !lookups.countries.some((c) => c.name === trip.country) ? (
              <option value={trip.country}>{trip.country}</option>
            ) : null}
          </select>
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
            className={`${fieldClass} tv-tnum`}
          />
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

      <div className="mt-4 grid grid-cols-3 gap-4">
        <label className={labelClass}>
          {t("pg.adults")}
          <input
            type="number"
            min={0}
            dir="ltr"
            value={trip.adults}
            onChange={(e) => update({ adults: Math.max(Number(e.target.value) || 0, 0) })}
            className={`${fieldClass} tv-tnum text-center`}
          />
        </label>
        <label className={labelClass}>
          {t("pg.children")}
          <input
            type="number"
            min={0}
            dir="ltr"
            value={trip.children}
            onChange={(e) => update({ children: Math.max(Number(e.target.value) || 0, 0) })}
            className={`${fieldClass} tv-tnum text-center`}
          />
        </label>
        <label className={labelClass}>
          {t("pg.infants")}
          <input
            type="number"
            min={0}
            dir="ltr"
            value={trip.infants}
            onChange={(e) => update({ infants: Math.max(Number(e.target.value) || 0, 0) })}
            className={`${fieldClass} tv-tnum text-center`}
          />
        </label>
      </div>
    </section>
  );
}
