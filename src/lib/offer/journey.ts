/**
 * A JOURNEY, not a list of legs.
 *
 * The generator already stored several flights per direction, but it drew them
 * as unrelated rows — so a Riyadh→Istanbul→Baku trip looked like two flights
 * that happened to be in the same offer, and the four-hour wait between them,
 * the thing the traveller actually asks about, was nowhere.
 *
 * This groups the legs into outbound / inbound / domestic chains and computes
 * the connection at each stop. The layover is the ONE number here that cannot be
 * eyeballed: the two clocks belong to different timezones, so subtracting the
 * printed times is wrong whenever the transit crosses a zone — which is most of
 * the time. It goes through toInstant, like the leg duration already does.
 *
 * Pure: no React, no Supabase, no clock.
 */

import { flightTiming, toInstant, type ScheduleFlight } from "./schedule";
import type { FlightLegOrder } from "@/lib/types";

/** A connection that is too tight to make, in the airlines' own rule of thumb. */
export const MIN_CONNECTION_MINUTES = 60;
/** Past this a "connection" is really an overnight the client must be told about. */
export const LONG_LAYOVER_MINUTES = 8 * 60;

export type JourneyLeg<T extends ScheduleFlight> = {
  flight: T;
  /** position within its own chain, 1-based — what the UI numbers. */
  segment: number;
  durationMinutes: number | null;
  dayOffset: number;
  arrivalBeforeDeparture: boolean;
  /**
   * Wait at the airport BEFORE this leg, in minutes. null on the first leg of a
   * chain, and null whenever either side lacks a resolvable timezone — an
   * unknown layover is printed as unknown, never guessed from wall clocks.
   */
  layoverMinutes: number | null;
  /** the layover is shorter than airlines will normally protect. */
  layoverTooShort: boolean;
  /** long enough that it is really an overnight / a day in the city. */
  layoverLong: boolean;
};

export type Journey<T extends ScheduleFlight> = {
  leg_order: FlightLegOrder;
  legs: JourneyLeg<T>[];
  /** true when the chain has more than one leg — i.e. it is a transit. */
  isTransit: boolean;
  /** gate-to-gate including the waits; null when any piece is unknown. */
  totalMinutes: number | null;
};

/**
 * Minutes between landing on one leg and taking off on the next.
 *
 * Both sides are converted to absolute instants first. Two flights can show
 * "14:00 arrival" and "15:00 departure" and be one hour apart, or five, or
 * minus two — the printed clocks say nothing until the zones are applied.
 * Returns null rather than a plausible-looking wrong number.
 */
export function layoverMinutes(previous: ScheduleFlight, next: ScheduleFlight): number | null {
  const landed = toInstant(previous.arrival_at, previous.to_tz);
  const departs = toInstant(next.departure_at, next.from_tz);
  if (!landed || !departs) return null;
  return Math.round((departs.getTime() - landed.getTime()) / 60_000);
}

/** Group legs into their chains, preserving the order they were entered in. */
export function buildJourneys<T extends ScheduleFlight>(flights: T[]): Journey<T>[] {
  const order: FlightLegOrder[] = ["outbound", "inbound", "internal"];
  const journeys: Journey<T>[] = [];

  for (const leg_order of order) {
    const chain = flights.filter((f) => f.leg_order === leg_order);
    if (chain.length === 0) continue;

    const legs: JourneyLeg<T>[] = chain.map((flight, i) => {
      const timing = flightTiming(flight);
      const wait = i === 0 ? null : layoverMinutes(chain[i - 1], flight);
      return {
        flight,
        segment: i + 1,
        durationMinutes: timing.durationMinutes,
        dayOffset: timing.dayOffset,
        arrivalBeforeDeparture: timing.arrivalBeforeDeparture,
        layoverMinutes: wait,
        // a NEGATIVE wait is not "short", it is impossible — the next flight
        // leaves before this one lands. Flag it the same way so the agent looks.
        layoverTooShort: wait !== null && wait < MIN_CONNECTION_MINUTES,
        layoverLong: wait !== null && wait >= LONG_LAYOVER_MINUTES,
      };
    });

    // Gate to gate: every leg plus every wait. One unknown piece makes the whole
    // total unknown — a partial sum reads as a real answer and is not one.
    const pieces: (number | null)[] = [
      ...legs.map((l) => l.durationMinutes),
      ...legs.slice(1).map((l) => l.layoverMinutes),
    ];
    const totalMinutes = pieces.every((p): p is number => p !== null)
      ? pieces.reduce((sum, p) => sum + p, 0)
      : null;

    journeys.push({ leg_order, legs, isTransit: legs.length > 1, totalMinutes });
  }

  return journeys;
}

/** "٤ ساعات و٣٠ دقيقة" — for the layover chip, which reads as prose not a stat. */
export function formatWaitAr(minutes: number | null): string | null {
  if (minutes === null || Number.isNaN(minutes)) return null;
  if (minutes < 0) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} دقيقة`;
  if (mins === 0) return hours === 1 ? "ساعة واحدة" : hours === 2 ? "ساعتان" : `${hours} ساعات`;
  return `${hours} س ${mins} د`;
}
