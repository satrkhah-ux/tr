/**
 * Offer scheduling — the ONE tz-correct, pure, testable module for how dates flow
 * through the package generator (trip → flights → hotels). No React, no I/O.
 *
 * WHY date-fns-tz (not naive strings, not the Temporal polyfill): flight times are
 * entered as LOCAL wall-clock at the origin/destination, whose true instant depends
 * on each airport's IANA timezone (never the server tz or the browser tz). date-fns-tz's
 * `fromZonedTime(localWallClock, ianaTz)` resolves a local time in a named zone to a
 * real UTC instant (DST-aware), which is exactly what a correct duration needs. It is
 * mature, tiny, tree-shakeable and works today in Node + the browser, whereas the
 * Temporal polyfill is large and still Stage-3. We keep the local wall-clock + the
 * airport tz as the source of truth; the UTC instant is DERIVED (`toInstant`), so a
 * stored instant can never drift out of sync with the stored local time.
 *
 * IMPORTANT: the "+N days" overnight badge compares LOCAL calendar dates (wall clock at
 * each airport) — that is a wall-clock comparison by definition. Only DURATION crosses
 * zones, and that is the only place we build UTC instants.
 */

import { differenceInCalendarDays, differenceInMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import type { FlightLegOrder } from "@/lib/types";

export type IsoDate = string; // "YYYY-MM-DD"
export type LocalDateTime = string; // "YYYY-MM-DDTHH:mm" (an <input type=datetime-local> value)

/** Minimal flight shape the scheduler needs (a superset lives on DraftFlight). */
export type ScheduleFlight = {
  leg_order: FlightLegOrder;
  departure_at: LocalDateTime | null; // local wall clock at the ORIGIN airport
  arrival_at: LocalDateTime | null; // local wall clock at the DESTINATION airport
  from_tz: string | null; // origin IANA timezone
  to_tz: string | null; // destination IANA timezone
  date_user_set?: boolean; // once true, auto-fill leaves the departure date alone
};

export type ScheduleTrip = {
  arrival_date: IsoDate | null; // trip start (out to destination)
  departure_date: IsoDate | null; // trip end (back home)
};

const DATE_RE = /^(\d{4}-\d{2}-\d{2})/;
const TIME_RE = /T(\d{2}:\d{2})/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Wall-clock date part "YYYY-MM-DD" of a datetime-local (or date) string. */
export function localDatePart(value: string | null | undefined): IsoDate | null {
  if (!value) return null;
  const m = value.match(DATE_RE);
  return m ? m[1] : null;
}

/** Wall-clock time part "HH:mm" of a datetime-local string. */
export function localTimePart(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(TIME_RE);
  return m ? m[1] : null;
}

/** Replace the date part of a datetime-local while KEEPING its time (default 00:00). */
export function withDatePart(value: LocalDateTime | null, isoDate: IsoDate | null): LocalDateTime | null {
  if (!isoDate) return value;
  const time = localTimePart(value) ?? "00:00";
  return `${isoDate}T${time}`;
}

/** The true UTC instant of a local wall-clock time in a given IANA zone. null if unresolvable. */
export function toInstant(localDateTime: LocalDateTime | null, tz: string | null): Date | null {
  if (!localDateTime || !tz || !DATETIME_RE.test(localDateTime)) return null;
  try {
    const instant = fromZonedTime(localDateTime, tz);
    return Number.isNaN(instant.getTime()) ? null : instant;
  } catch {
    return null;
  }
}

export type FlightTiming = {
  /** tz-correct duration in minutes (needs both times AND both airport tzs); null otherwise. */
  durationMinutes: number | null;
  /** arrival LOCAL date − departure LOCAL date (0 = same day, 1 = "+1 يوم" …). */
  dayOffset: number;
  /** the arrival instant is before the departure instant (impossible flight). */
  arrivalBeforeDeparture: boolean;
};

/** Duration (tz-correct) + local day offset for a single leg. */
export function flightTiming(leg: ScheduleFlight): FlightTiming {
  const depDate = localDatePart(leg.departure_at);
  const arrDate = localDatePart(leg.arrival_at);
  const dayOffset =
    depDate && arrDate
      ? differenceInCalendarDays(new Date(`${arrDate}T00:00:00Z`), new Date(`${depDate}T00:00:00Z`))
      : 0;

  const depInstant = toInstant(leg.departure_at, leg.from_tz);
  const arrInstant = toInstant(leg.arrival_at, leg.to_tz);
  const durationMinutes = depInstant && arrInstant ? differenceInMinutes(arrInstant, depInstant) : null;

  return {
    durationMinutes,
    dayOffset,
    arrivalBeforeDeparture: durationMinutes !== null && durationMinutes < 0,
  };
}

/** Arabic "13 س 30 د" — Latin digits are LTR-isolated by the caller (DirText). */
export function formatDurationAr(minutes: number | null): string | null {
  if (minutes === null || Number.isNaN(minutes)) return null;
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  const sign = minutes < 0 ? "-" : "";
  return `${sign}${hours} س ${mins} د`;
}

/** Trip-driven auto DEPARTURE date for a leg: outbound → trip start, inbound → trip end. */
export function autoDepartureDate(trip: ScheduleTrip, leg: FlightLegOrder): IsoDate | null {
  if (leg === "outbound") return trip.arrival_date;
  if (leg === "inbound") return trip.departure_date;
  return null; // internal legs are not trip-driven
}

/**
 * Re-apply trip-driven departure dates to every leg the agent hasn't manually
 * date-edited (`date_user_set`). Only the DATE part moves; the time is preserved.
 */
export function syncDepartureDates<T extends ScheduleFlight>(trip: ScheduleTrip, flights: T[]): T[] {
  return flights.map((flight) => {
    if (flight.date_user_set) return flight;
    const auto = autoDepartureDate(trip, flight.leg_order);
    if (!auto) return flight;
    const next = withDatePart(flight.departure_at, auto);
    return next === flight.departure_at ? flight : { ...flight, departure_at: next };
  });
}

/**
 * The first hotel check-in: the LOCAL arrival date of the outbound (to-destination)
 * flight — so an after-midnight landing checks in on the day it actually lands, not
 * the trip start. Falls back to the trip start when there is no outbound flight.
 */
export function itineraryStartDate(trip: ScheduleTrip, flights: ScheduleFlight[]): IsoDate | null {
  const outbound = flights.find((f) => f.leg_order === "outbound");
  return localDatePart(outbound?.arrival_at) ?? trip.arrival_date;
}

/** The last hotel check-out: the LOCAL departure date of the inbound (home-bound) flight. */
export function itineraryEndDate(trip: ScheduleTrip, flights: ScheduleFlight[]): IsoDate | null {
  const inbound = flights.find((f) => f.leg_order === "inbound");
  return localDatePart(inbound?.departure_at) ?? trip.departure_date;
}

export type NightsStatus = "complete" | "remaining" | "excess";

/** Live nights-allocation status against the trip nights. */
export function nightsStatus(used: number, total: number): { status: NightsStatus; diff: number } {
  if (used < total) return { status: "remaining", diff: total - used };
  if (used > total) return { status: "excess", diff: used - total };
  return { status: "complete", diff: 0 };
}
