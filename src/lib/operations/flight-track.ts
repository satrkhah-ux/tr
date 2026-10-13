/**
 * Flight tracking on the travel day (operations order 11, suggestion 4): the
 * reception follows the flight's REAL landing, not the one printed weeks ago.
 *
 * The provider (AviationStack) is asked for the flight a reception meets; when
 * its estimated or actual landing differs from what the reception was last
 * timed on by more than DRIFT_MINUTES, the meeting time moves to landing + 45
 * minutes — the same rule the pull and flight-follow use — and operations and
 * the driver are told. Small drifts are left alone: a driver re-sent a time
 * for every five minutes stops reading them.
 *
 * Every time here is a local wall clock «YYYY-MM-DDTHH:mm» at the arrival
 * airport (the provider's own clock; see flight-lookup.ts toWallClock).
 *
 * Pure: no React, no Supabase.
 */

import { DRV, driverServiceKind, driverStep, flightLegs, linkOf, type Leg } from "./drivers";
import { MEET_AFTER_LANDING, shift } from "./seed-plan";

export const DRIFT_MINUTES = 15;

/** One provider row, reduced to what tracking needs. */
export type FlightObservation = {
  /** the departure's local date — the provider's «flight_date». */
  flight_date: string | null;
  to: string;
  scheduled: string | null;
  estimated: string | null;
  actual: string | null;
};

const minutes = (a: string, b: string) => (Date.parse(`${a}:00Z`) - Date.parse(`${b}:00Z`)) / 60_000;

/** «2026-11-20 15:20» (as stored) ⇄ «2026-11-20T15:20». */
export const toStored = (at: string) => at.replace("T", " ");
export function trackedLanding(detail: Record<string, string> | null): string | null {
  const m = detail?.[DRV.landing]?.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : null;
}

/** The provider's row for our leg: the same arrival airport, the same day — a number flies daily. */
export function pickObservation(rows: FlightObservation[], leg: Pick<Leg, "to" | "departure" | "arrival">): FlightObservation | null {
  return (
    rows.find(
      (r) =>
        (!leg.to || !r.to || r.to === leg.to) &&
        ((leg.arrival !== null && r.scheduled?.slice(0, 10) === leg.arrival.slice(0, 10)) ||
          (leg.departure !== null && r.flight_date === leg.departure.slice(0, 10))),
    ) ?? null
  );
}

export type TrackDecision = {
  /** the landing the reception is now timed on. */
  landing: string;
  /** minutes against the planned landing: + late, − early. */
  delay: number;
  meet: { date: string; time: string };
  /** the provider reports it on the ground. */
  landed: boolean;
};

/**
 * Move the reception or not. `planned` is the landing in our flight booking,
 * `tracked` the one this reception was last moved to (null until the first
 * move), so a delay announced at 10:00 is not announced again at 10:30.
 */
export function trackDecision(input: {
  planned: string | null;
  tracked: string | null;
  observed: FlightObservation;
  drift?: number;
}): TrackDecision | null {
  const landing = input.observed.actual ?? input.observed.estimated;
  const plan = input.planned ?? input.observed.scheduled;
  const base = input.tracked ?? plan;
  if (!landing || !plan || !base) return null;
  if (Math.abs(minutes(landing, base)) <= (input.drift ?? DRIFT_MINUTES)) return null;
  return { landing, delay: minutes(landing, plan), meet: shift(landing, MEET_AFTER_LANDING), landed: input.observed.actual !== null };
}

/**
 * Worth a provider call now: from six hours before the landing to two after.
 * Without the airport's time zone the caller's date filter (today, tomorrow) is
 * the only bound.
 */
export function inWindow(landingInstant: Date | null, now: Date): boolean {
  if (!landingInstant) return true;
  const ahead = landingInstant.getTime() - now.getTime();
  return ahead <= 6 * 3_600_000 && ahead >= -2 * 3_600_000;
}

type Booking = { id: string; operation_id: string; kind: string; title: string; start_date: string | null; detail: Record<string, string> | null };

export type TrackTarget = { id: string; operation_id: string; flight_no: string; leg: Leg; tracked: string | null };

/**
 * The receptions to follow: tied to a numbered flight we hold, and the guests
 * not yet picked up. Found by number, then by route — the same match
 * flight-follow uses when the airline renumbers a flight.
 */
export function trackTargets(transfers: Booking[], flights: { operation_id: string; detail: Record<string, string> | null }[]): TrackTarget[] {
  const out: TrackTarget[] = [];
  for (const t of transfers) {
    if (driverServiceKind(t) !== "reception" || driverStep(t.detail) === "done") continue;
    const link = linkOf(t.detail?.[DRV.flight]);
    if (!link?.flight_no) continue;
    const legs = flights.filter((f) => f.operation_id === t.operation_id).flatMap((f) => flightLegs(f.detail ?? {}).map((l) => l.leg));
    const leg =
      legs.find((l) => l.flight_no === link.flight_no) ?? legs.find((l) => l.from === link.from && l.to === link.to) ?? null;
    if (!leg) continue;
    out.push({ id: t.id, operation_id: t.operation_id, flight_no: leg.flight_no || link.flight_no, leg, tracked: trackedLanding(t.detail) });
  }
  return out;
}
