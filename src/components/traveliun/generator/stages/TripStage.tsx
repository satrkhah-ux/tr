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
    </section>
  );
}
