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
  // no cities yet: nothing to disagree with (the flights may come first)
  if (cities.length === 0) return [];
  // the group may land in a city it does not stay in and fly on to the first one
  // the same day — and fly from the last city to where the flight home leaves
  const landing = flights.filter((f) => f.leg_order === "outbound").sort(byDeparture).at(-1)?.to_city?.trim();
  const home = flights.filter((f) => f.leg_order === "inbound").sort(byDeparture)[0]?.from_city?.trim();
  const first = cities[0];
  const last = cities[cities.length - 1];
  // A connection the same day (KUL → PEN → LGK) leaves no night in the middle
  // city, so the two legs are ONE move: from the first leg's city to the last
  // leg's, on the first leg's day.
  const legs = flights.filter((f) => f.leg_order === "internal").sort(byDeparture);
  const moves: { legs: DraftFlight[]; from: string; to: string; day: string | null }[] = [];
  for (const leg of legs) {
    const prev = moves.at(-1);
    const last = prev?.legs.at(-1);
    const connects =
      last &&
      last.to_city?.trim() &&
      last.to_city.trim() === leg.from_city?.trim() &&
      localDatePart(last.arrival_at) === localDatePart(leg.departure_at);
    if (prev && connects) {
      prev.legs.push(leg);
      prev.to = leg.to_city?.trim() ?? "";
    } else {
      moves.push({
        legs: [leg],
        from: leg.from_city?.trim() ?? "",
        to: leg.to_city?.trim() ?? "",
        day: localDatePart(leg.departure_at),
      });
    }
  }
  return moves
    .filter((m) => {
      if (!m.from || !m.to || !m.day) return false;
      if (first && m.from === landing && m.to === first.city_name) return Boolean(first.check_in && first.check_in !== m.day);
      if (last && m.to === home && m.from === last.city_name) return Boolean(last.check_out && last.check_out !== m.day);
      const i = cities.findIndex((c, k) => c.city_name === m.from && cities[k + 1]?.city_name === m.to);
      if (i < 0) return true;
      const change = cities[i].check_out;
      return Boolean(change && change !== m.day);
    })
    .flatMap((m) => m.legs);
}

/**
 * What each segment of a built route is, from the countries its airports are in.
 *
 * One multi-city route holds the whole trip — out, around, home — so the agent
 * does not split it into an international and a domestic booking by hand: a
 * segment with both ends in the trip's country is domestic, the ones before the
 * group first lands there are outbound (a transit through Dubai included), and
 * the ones after it are the way home. When the airports' countries are not
 * known (an airport not linked to a city), the old reading stands: the first
 * segment out, the last one home.
 */
export function routeLegOrders(
  segments: { from: string | null; to: string | null }[],
  tripCountry: string | null,
): ("outbound" | "internal" | "inbound")[] {
  const fallback = segments.map((_, i) => (i === segments.length - 1 && i > 0 ? "inbound" : "outbound") as "outbound" | "inbound");
  if (!tripCountry || !segments.some((s) => s.to === tripCountry)) return fallback;
  let arrived = false;
  return segments.map((s) => {
    if (s.from === tripCountry && s.to === tripCountry) {
      arrived = true;
      return "internal";
    }
    const order = arrived ? "inbound" : "outbound";
    if (s.to === tripCountry) arrived = true;
    return order;
  });
}
