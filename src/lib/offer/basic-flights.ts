/**
 * «بيسك» — the flights step (the owner, 2026-10-22): the flight number first,
 * looked up and filled in; the domestic flights in the same step, each with its
 * own price; and the cities built from all of it on «التالي».
 *
 * Pure: no React, no Supabase.
 */

import type { FlightLookupHit } from "@/lib/providers/flight-lookup";
import {
  cityKeys,
  hopKey,
  intercityModes,
  withCityKeys,
  type DraftCity,
  type DraftData,
  type DraftFlight,
  type DraftTrip,
  type LookupAirport,
  type TransportMode,
} from "./draft-types";
import { airportDisplay, findAirport } from "./basic";
import { citiesFromFlights, flownInto } from "./flight-cities";
import { parseFlightNumber } from "./flight-number";
import { autoDepartureDate, localDatePart, localTimePart, toInstant } from "./schedule";

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/**
 * The landing as a wall clock, from the take-off and the landing's clock: the
 * first day (0–2 after the take-off) that makes a flight of under 20 hours by
 * the two airports' own zones — MED 23:00 → KUL 13:00 is the next day — else,
 * with a zone unknown, the next day for a clock earlier than the take-off.
 */
export function landingAt(departure_at: string, from_tz: string | null, arrTime: string, to_tz: string | null): string {
  const day = departure_at.slice(0, 10);
  const off = toInstant(departure_at, from_tz);
  if (off) {
    for (let n = 0; n <= 2; n++) {
      const at = `${addDays(day, n)}T${arrTime}`;
      const on = toInstant(at, to_tz);
      const minutes = on ? (on.getTime() - off.getTime()) / 60_000 : null;
      if (minutes != null && minutes > 0 && minutes < 20 * 60) return at;
    }
  }
  return `${arrTime < departure_at.slice(11, 16) ? addDays(day, 1) : day}T${arrTime}`;
}

/** What the agent changes on a leg: its fields, its day, its two clocks. */
export type LegChange = Partial<Pick<DraftFlight, "flight_no" | "airline" | "airline_iata" | "from_airport" | "to_airport" | "price" | "cabin_class">> & {
  /** "YYYY-MM-DD"; "" clears it */
  date?: string;
  /** "HH:mm"; "" clears it */
  dep?: string;
  arr?: string;
};

/**
 * One leg changed, found by its id — never by its cities, so a leg whose
 * airport the agent corrects stays the same leg. An airport resolves its zone
 * and city; a new day moves the landing with it; a domestic leg the cities
 * wrote becomes the agent's own (withDomesticFlights leaves it alone after).
 */
export function changeLeg(data: Pick<DraftData, "trip" | "flights">, airports: LookupAirport[], id: string, change: LegChange): DraftFlight[] {
  return data.flights.map((f) => {
    if (f.id !== id) return f;
    const { date, dep, arr, ...fields } = change;
    let next: DraftFlight = { ...f, ...fields };
    if (fields.from_airport !== undefined) {
      const a = findAirport(fields.from_airport, airports);
      next = { ...next, from_tz: a?.timezone ?? null, from_city: a?.city ?? "" };
    }
    if (fields.to_airport !== undefined) {
      const b = findAirport(fields.to_airport, airports);
      next = { ...next, to_tz: b?.timezone ?? null, to_city: b?.city ?? "" };
    }
    if (date !== undefined) {
      const was = localDatePart(f.departure_at);
      const auto = autoDepartureDate(data.trip, f.leg_order);
      next = {
        ...next,
        departure_at: date ? `${date}T${localTimePart(f.departure_at) ?? "00:00"}` : null,
        // the landing keeps its distance from the take-off
        arrival_at: date && was && f.arrival_at ? `${addDays(localDatePart(f.arrival_at)!, daysBetween(was, date))}T${localTimePart(f.arrival_at)}` : date ? f.arrival_at : null,
        // a domestic leg has no trip day to follow: its day is always the agent's
        date_user_set: Boolean(date) && (auto === null || date !== auto),
      };
    }
    const day = localDatePart(next.departure_at);
    if (dep !== undefined && day) next = { ...next, departure_at: `${day}T${dep || "00:00"}` };
    const landing = arr !== undefined ? arr : dep !== undefined ? localTimePart(next.arrival_at) : null;
    if (landing !== null && next.departure_at) {
      next = { ...next, arrival_at: landing ? landingAt(next.departure_at, next.from_tz, landing, next.to_tz) : null };
    }
    return next.leg_order === "internal" && next.auto ? { ...next, auto: undefined } : next;
  });
}

/** A new domestic leg, from where the group last landed; its day is the agent's to give. */
export function newDomesticLeg(data: Pick<DraftData, "flights" | "flight_booking">, blank: DraftFlight): DraftFlight {
  const byDay = (a: DraftFlight, b: DraftFlight) => (a.departure_at ?? "").localeCompare(b.departure_at ?? "");
  const before = data.flights.filter((f) => f.leg_order === "internal").sort(byDay).at(-1) ?? data.flights.filter((f) => f.leg_order === "outbound").sort(byDay).at(-1);
  return {
    ...blank,
    from_airport: before?.to_airport ?? "",
    from_tz: before?.to_tz ?? null,
    from_city: before?.to_city ?? "",
    cabin_class: data.flight_booking.cabin,
  };
}

/** The domestic booking's total: its legs' prices added up — null while no leg has one. */
export function domesticTotal(flights: DraftFlight[]): number | null {
  const priced = flights.filter((f) => f.leg_order === "internal" && f.price != null);
  return priced.length > 0 ? Math.round(priced.reduce((sum, f) => sum + (f.price ?? 0), 0) * 100) / 100 : null;
}

/**
 * A looked-up flight laid onto the agent's leg. The provider's plan returns
 * only today's flights (a future date is refused — 403), so the ROUTE and the
 * CLOCKS are taken and the DAY stays the agent's — with `checkDate` set so the
 * screen says «تحقق من التاريخ». An outbound still on the trip's own day that
 * lands the next day is dated by its LANDING: the trip's arrival day is the day
 * it lands. The number stays as the agent typed it (the provider may answer
 * with a codeshare's), the airline is the one the number names; our airport
 * rows win over the provider's names (they carry the zone and the city).
 */
export function applyFlightHit(
  leg: DraftFlight,
  hit: FlightLookupHit,
  ctx: { airports: LookupAirport[]; airlines: { iata: string; name: string }[]; trip: Pick<DraftTrip, "arrival_date" | "departure_date"> },
): { leg: DraftFlight; checkDate: boolean } {
  const ours = (code: string, name: string) => {
    const a = code ? ctx.airports.find((x) => x.code?.toUpperCase() === code.toUpperCase()) : undefined;
    return a ? { value: airportDisplay(a), tz: a.timezone, city: a.city ?? "" } : { value: code ? (name ? `${name} (${code})` : code) : name, tz: null, city: "" };
  };
  const from = ours(hit.from_iata, hit.from_airport);
  const to = ours(hit.to_iata, hit.to_airport);
  const parsed = parseFlightNumber(leg.flight_no) ?? parseFlightNumber(hit.flight_iata);
  const carrier = parsed ? ctx.airlines.find((a) => a.iata.toUpperCase() === parsed.carrier) : undefined;
  const depTime = localTimePart(hit.departure_at);
  const arrTime = localTimePart(hit.arrival_at);
  const offset = hit.departure_at && hit.arrival_at ? Math.max(daysBetween(hit.departure_at.slice(0, 10), hit.arrival_at.slice(0, 10)), 0) : 0;

  let day = localDatePart(leg.departure_at) ?? autoDepartureDate(ctx.trip, leg.leg_order);
  let pinned = leg.date_user_set;
  if (leg.leg_order === "outbound" && !leg.date_user_set && ctx.trip.arrival_date && offset > 0) {
    day = addDays(ctx.trip.arrival_date, -offset);
    pinned = true;
  }
  const departure_at = day ? `${day}T${depTime ?? localTimePart(leg.departure_at) ?? "00:00"}` : leg.departure_at;
  const arrival_at = day && arrTime ? `${addDays(day, offset)}T${arrTime}` : leg.arrival_at;
  return {
    leg: {
      ...leg,
      flight_no: (parsed?.code ?? leg.flight_no).toUpperCase(),
      airline: carrier?.name || hit.airline || leg.airline,
      airline_iata: carrier?.iata ?? parsed?.carrier ?? leg.airline_iata,
      from_airport: from.value || leg.from_airport,
      to_airport: to.value || leg.to_airport,
      from_tz: from.tz ?? hit.from_tz ?? leg.from_tz,
      to_tz: to.tz ?? hit.to_tz ?? leg.to_tz,
      from_city: from.city || (from.value ? "" : (leg.from_city ?? "")),
      to_city: to.city || (to.value ? "" : (leg.to_city ?? "")),
      departure_at,
      arrival_at,
      date_user_set: pinned,
      ...(leg.leg_order === "internal" ? { auto: undefined } : {}),
    },
    checkDate: Boolean(hit.schedule_date && hit.schedule_date !== day),
  };
}

/**
 * «التالي» from the flights to the cities: the stops the flights describe
 * (citiesFromFlights), laid over the cities the file has.
 *
 *  · a stop still marked `from_flight` takes the flights' nights (and night in
 *    the air); its key — so its hotel lines — its tours and its services stay;
 *  · a stop the agent edited by hand (no mark) stays exactly as it is, where it is;
 *  · a city the flights now reach is added after the stop before it, with a
 *    tour day as the add bar would give it, and its country when not the trip's;
 *  · a marked stop the flights no longer reach goes, with its own hotel lines;
 *  · each added or updated stop is flown into, or driven into (the city a
 *    flight home leaves from) — written into the hops, and the mode switched on.
 *
 * Null while the flights cannot say the cities (citiesFromFlights).
 */
export function withCitiesFromFlights(
  data: DraftData,
  countryOf: (city: string) => string | undefined = () => undefined,
): Pick<DraftData, "cities" | "hotels" | "transport_plan"> | null {
  const derived = citiesFromFlights(data.flights, data.trip.departure_date);
  if (!derived) return null;
  const current = withCityKeys(data.cities);
  const used = new Set<number>();
  const toursOn = data.transport_plan.tours.enabled;
  let after = -1;
  const placed = derived.map((d) => {
    const j = current.findIndex((c, k) => !used.has(k) && c.city_name.trim() === d.city_name);
    if (j < 0) {
      // just after the stop the flights put before it (several new ones keep their order)
      after += 0.001;
      const country = countryOf(d.city_name);
      return {
        at: after,
        stop: {
          ...d,
          tours: toursOn ? Math.min(1, Math.max(d.nights - 1, 0)) : 0,
          ...(country && country !== data.trip.country ? { country } : {}),
        } as DraftCity,
      };
    }
    used.add(j);
    after = j;
    const c = current[j];
    if (!c.from_flight) return { at: j, stop: c };
    return { at: j, stop: { ...c, nights: d.nights, arrives_next_day: d.arrives_next_day, tours: Math.min(c.tours ?? 0, d.nights) } };
  });
  const kept = current.flatMap((c, k) => (!used.has(k) && !c.from_flight ? [{ at: k, stop: c }] : []));
  const cities = withCityKeys([...placed, ...kept].sort((a, b) => a.at - b.at).map((x) => x.stop));

  // the stops that went take their own hotel lines; a line of an older file goes by its city's name
  const keys = new Set(cityKeys(cities));
  const names = new Set(cities.map((c) => c.city_name.trim()));
  const hotels = data.hotels.filter((h) => (h.city_key && cityKeys(current).includes(h.city_key) ? keys.has(h.city_key) : names.has(h.city_name.trim())));

  const plan = data.transport_plan;
  const hop_modes = { ...plan.intercity.hop_modes };
  const modes = new Set<TransportMode>(intercityModes(plan));
  cities.forEach((c, i) => {
    if (i === 0 || !c.from_flight) return;
    const mode: TransportMode = flownInto(data.flights, cities, i) ? "flight" : "car";
    hop_modes[hopKey(cities[i - 1].city_name, c.city_name)] = mode;
    modes.add(mode);
  });
  const list = [...modes];
  return {
    cities,
    hotels,
    transport_plan: { ...plan, intercity: { ...plan.intercity, modes: list, mode: list[0], hop_modes } },
  };
}
