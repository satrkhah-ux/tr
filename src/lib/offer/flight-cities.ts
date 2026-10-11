/**
 * The cities a trip visits, read off its flights.
 *
 * The outbound flight lands in the first city; each domestic flight lands in
 * the next one; the inbound flight leaves from the last. The dates on those
 * flights ARE the nights: the group sleeps in a city from the day it lands
 * there until the day it flies on. So once the flights are in, the agent does
 * not type the cities a second time — only picks the hotels.
 *
 * Pure: no React, no Supabase.
 */

import type { DraftCity, DraftFlight } from "./draft-types";
import { localDatePart } from "./schedule";

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const byDeparture = (a: DraftFlight, b: DraftFlight) => (a.departure_at ?? "").localeCompare(b.departure_at ?? "");

/**
 * The city chain the flights describe, or null while they cannot say it yet —
 * an airport not linked to a city, a time not entered, or legs out of order.
 * Null means «leave the cities as the agent has them», never «no cities».
 */
export function citiesFromFlights(flights: DraftFlight[]): DraftCity[] | null {
  const outbound = flights.filter((f) => f.leg_order === "outbound").sort(byDeparture);
  const inbound = flights.filter((f) => f.leg_order === "inbound").sort(byDeparture);
  const domestic = flights.filter((f) => f.leg_order === "internal").sort(byDeparture);
  // A transit outbound is two legs; the group arrives where the LAST one lands.
  const landing = outbound[outbound.length - 1];
  const leaving = inbound[0];
  if (!landing || !leaving) return null;

  const stops: { city: string; from: string | null }[] = [
    { city: landing.to_city?.trim() ?? "", from: localDatePart(landing.arrival_at) },
    ...domestic.map((f) => ({ city: f.to_city?.trim() ?? "", from: localDatePart(f.arrival_at) })),
  ];
  const end = localDatePart(leaving.departure_at);
  if (!end || stops.some((s) => !s.city || !s.from)) return null;

  const cities: DraftCity[] = [];
  for (const [i, stop] of stops.entries()) {
    const until = i < stops.length - 1 ? stops[i + 1].from! : end;
    const nights = daysBetween(stop.from!, until);
    if (nights < 0) return null;
    // a same-day hop leaves no night in the city it passed through
    if (nights === 0) continue;
    cities.push({ city_name: stop.city, nights, check_in: null, check_out: null, from_flight: true });
  }
  return cities.length > 0 ? cities : null;
}

/** True when the cities on the draft are the ones the flights describe (names and nights, in order). */
export function citiesMatchFlights(cities: DraftCity[], derived: DraftCity[]): boolean {
  return (
    cities.length === derived.length &&
    cities.every((c, i) => c.city_name === derived[i].city_name && c.nights === derived[i].nights)
  );
}

/**
 * A domestic flight that does not move the group between two cities that
 * follow each other in the programme on the day they change — the booking and
 * the programme would then disagree about where the group sleeps.
 *
 * Only judged when both airports are linked to cities and the dates exist;
 * anything unknown is not called a mismatch.
 */
export function domesticMismatches(flights: DraftFlight[], cities: DraftCity[]): DraftFlight[] {
  return flights
    .filter((f) => f.leg_order === "internal")
    .filter((f) => {
      const from = f.from_city?.trim();
      const to = f.to_city?.trim();
      const day = localDatePart(f.departure_at);
      if (!from || !to || !day) return false;
      const i = cities.findIndex((c, k) => c.city_name === from && cities[k + 1]?.city_name === to);
      if (i < 0) return true;
      const change = cities[i].check_out;
      return Boolean(change && change !== day);
    });
}
