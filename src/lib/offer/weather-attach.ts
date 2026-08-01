import "server-only";
import { getCityWeather } from "@/lib/providers/weather";
import type { DraftDay } from "./draft-types";

/**
 * Put a real weather reading on every dated day.
 *
 * Lives on its own because TWO callers need it and they must agree: the button
 * on the itinerary stage, and the producer — which attaches it automatically so
 * a document cannot go out saying «بيانات الطقس غير مرفقة» merely because
 * nobody pressed the button. That sentence was appearing on finished offers,
 * and it read to the client as something we forgot rather than something we
 * chose.
 *
 * One provider round-trip per CITY, not per day. Readings are snapshotted by
 * the caller: a published document must print the same numbers forever and must
 * never depend on an external API being up when a PDF is rendered.
 */
export async function attachWeather(
  days: DraftDay[],
  /** used for a day with no city of its own — usually the trip's destination. */
  fallbackPlace: string,
): Promise<{ days: DraftDay[]; attached: number }> {
  const placeFor = (d: DraftDay) => d.city_name.trim() || fallbackPlace.trim();
  const dated = days.filter((d) => d.date && placeFor(d));
  if (dated.length === 0) return { days, attached: 0 };

  const byCity = new Map<string, string[]>();
  for (const day of dated) {
    const place = placeFor(day);
    const list = byCity.get(place) ?? [];
    list.push(day.date as string);
    byCity.set(place, list);
  }

  const fetched_at = new Date().toISOString();
  const results = await Promise.all(
    [...byCity.entries()].map(async ([city, dates]) => ({ city, weather: await getCityWeather(city, dates) })),
  );

  const readings = new Map<string, DraftDay["weather"]>();
  for (const { city, weather } of results) {
    for (const day of weather.days) {
      readings.set(`${city}|${day.date}`, {
        temp_max: day.tempMax,
        temp_min: day.tempMin,
        rain_chance: day.rainChance,
        code: day.code,
        source: day.source,
        fetched_at,
      });
    }
  }

  let attached = 0;
  // A city the provider could not resolve keeps whatever it had — a partial
  // refresh must never blank out readings that are still good.
  const next = days.map((d) => {
    const hit = d.date ? readings.get(`${placeFor(d)}|${d.date}`) : undefined;
    if (!hit) return d;
    attached += 1;
    return { ...d, weather: hit };
  });

  return { days: next, attached };
}

/** True when no dated day carries a reading — what the producer checks before asking. */
export function weatherMissing(days: DraftDay[]): boolean {
  const dated = days.filter((d) => d.date);
  if (dated.length === 0) return false;
  return dated.every((d) => !d.weather || d.weather.temp_max == null);
}
