/**
 * Day-by-day itinerary — the pure model behind the «البرنامج اليومي» stage.
 *
 * The days are DERIVED, never hand-numbered: a trip of N nights has N+1 days,
 * each day's date comes from the arrival date, and each day's city comes from
 * the cities chain (the city whose stay covers that date). Only the TEXT is
 * authored — by the agent or the AI generator — and rebuilding the skeleton
 * preserves it, so changing the trip length never destroys written days.
 *
 * Pure module: no React, no Supabase, no network. Safe to import anywhere.
 */

import { deriveCityDates, type DraftCity, type DraftData, type DraftDay, type DraftTrip } from "./draft-types";
import { itineraryStartDate } from "./schedule";

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * How many days the program covers. Nights + 1 (arrival day … departure day);
 * falls back to the explicit `days` field for trips entered without nights.
 */
export function dayCount(trip: Pick<DraftTrip, "nights" | "days">): number {
  const nights = Number.isFinite(trip.nights) ? trip.nights : 0;
  if (nights > 0) return nights + 1;
  const days = Number.isFinite(trip.days) ? trip.days : 0;
  return Math.max(days, 0);
}

/**
 * The city a given date belongs to: the one whose stay covers it. The departure
 * date equals the last check-out, which no stay covers — it belongs to the last
 * city (you wake up there and fly home).
 */
export function cityForDate(date: string | null, cities: DraftCity[]): string {
  if (!date || cities.length === 0) return "";
  for (const city of cities) {
    if (city.check_in && city.check_out && date >= city.check_in && date < city.check_out) {
      return city.city_name;
    }
  }
  const last = cities[cities.length - 1];
  if (last?.check_out && date >= last.check_out) return last.city_name;
  return cities[0]?.city_name ?? "";
}

/**
 * Rebuild the day list from the trip + cities, carrying over the authored text
 * of any day that still exists. Returns a NEW array; inputs untouched.
 *
 * Matching is by day_number — shortening a trip drops the tail days (and their
 * text); lengthening it appends empty ones. Dates and cities are ALWAYS
 * recomputed, so they can never drift from the trip.
 */
export function buildDaySkeleton(
  trip: Pick<DraftTrip, "nights" | "days" | "arrival_date">,
  cities: DraftCity[],
  existing: DraftDay[] = [],
  /** used when the cities chain names no city — in practice the destination. */
  fallbackCity = "",
): DraftDay[] {
  const total = dayCount(trip);
  if (total <= 0) return [];
  const dated = deriveCityDates(trip.arrival_date, cities);
  const byNumber = new Map(existing.map((d) => [d.day_number, d]));

  return Array.from({ length: total }, (_, i) => {
    const day_number = i + 1;
    const date = trip.arrival_date ? addDays(trip.arrival_date, i) : null;
    const prior = byNumber.get(day_number);
    return {
      day_number,
      date,
      // Agents don't always name the cities (some put the city in the hotel
      // field), so fall back to the destination rather than leaving the day
      // placeless — the weather lookup and the printed document both need it.
      city_name: cityForDate(date, dated) || fallbackCity.trim(),
      title: prior?.title ?? "",
      activities: prior?.activities ?? [],
      // A cached reading is only valid for the date it was fetched for; if the
      // trip moved, drop it rather than print last month's weather.
      weather: prior && prior.date === date ? (prior.weather ?? null) : null,
      ai_generated: prior?.ai_generated ?? false,
    };
  });
}

/**
 * The skeleton for a whole draft. Uses the SAME start date as the rest of the
 * system (the outbound flight's arrival when there is one, else the trip's
 * arrival date) so day 1 can never disagree with the hotels or the cities.
 */
export function draftDaySkeleton(data: DraftData): DraftDay[] {
  return buildDaySkeleton(
    { ...data.trip, arrival_date: itineraryStartDate(data.trip, data.flights) },
    data.cities,
    data.days,
    data.trip.destination || data.trip.country,
  );
}

/** True when the skeleton is out of sync with the trip/cities (dates or cities moved). */
export function daysNeedRebuild(
  trip: Pick<DraftTrip, "nights" | "days" | "arrival_date">,
  cities: DraftCity[],
  days: DraftDay[],
  fallbackCity = "",
): boolean {
  const fresh = buildDaySkeleton(trip, cities, days, fallbackCity);
  if (fresh.length !== days.length) return true;
  return fresh.some((d, i) => d.date !== days[i].date || d.city_name !== days[i].city_name);
}

/** Days that carry no authored content — what the AI generator should fill. */
export function emptyDays(days: DraftDay[]): DraftDay[] {
  return days.filter((d) => !d.title.trim() && d.activities.every((a) => !a.trim()));
}

/** True once every day has a title — the itinerary reads as complete. */
export function itineraryComplete(days: DraftDay[]): boolean {
  return days.length > 0 && days.every((d) => d.title.trim().length > 0);
}

/** The distinct cities the itinerary visits, in order — the AI prompt's context. */
export function itineraryCities(days: DraftDay[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const day of days) {
    const name = day.city_name.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
