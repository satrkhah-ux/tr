"use server";

import type { TranslationKey } from "@/lib/i18n";
import { getServerUser } from "@/lib/supabase/server";
import { normalizeDraftDays, type DraftData, type DraftDay } from "@/lib/offer/draft-types";
import { draftDaySkeleton, itineraryCities } from "@/lib/offer/itinerary";
import { getCityWeather } from "@/lib/providers/weather";
import { generateItineraryText, isOpenAIConfigured, type ItineraryPromptDay } from "@/lib/providers/openai";
import { isFlightLookupConfigured, lookupFlight, type FlightLookupHit } from "@/lib/providers/flight-lookup";
import { getDraft, saveDraftStages } from "./drafts";

/**
 * The itinerary stage's three assisted actions: fetch real weather, draft the
 * day text with the AI, and look a flight number up.
 *
 * All three are SERVER actions because each holds a provider key or hits an
 * external API. All three are ADVISORY: they return data the agent reviews and
 * saves — none of them publishes anything, and every one degrades to a typed
 * error the UI shows inline rather than throwing.
 */

export type ItineraryActionResult = { ok: true; days: DraftDay[] } | { ok: false; error: TranslationKey };

/** Availability flags for the UI — never expose the keys themselves. */
export async function getAssistantAvailability(): Promise<{ ai: boolean; flightLookup: boolean }> {
  return { ai: isOpenAIConfigured(), flightLookup: isFlightLookupConfigured() };
}

/**
 * Build the skeleton the assistants work on.
 *
 * `localDays` is the stage's LIVE day list. The shell auto-saves on a debounce,
 * so text typed a moment before pressing an assistant button may not have
 * reached the database yet — reading days from the DB alone would hand back a
 * stale list and wipe that text. The client list wins for text; dates and
 * cities are still recomputed from the (authoritative) trip.
 */
function skeletonFor(data: DraftData, localDays: unknown): DraftDay[] {
  const normalized = normalizeDraftDays(localDays);
  return normalized.length > 0
    ? draftDaySkeleton({ ...data, days: normalized })
    : draftDaySkeleton(data);
}

/**
 * Attach a real weather reading to every dated day, city by city (one provider
 * round-trip per city, not per day). Readings are SNAPSHOTTED into the draft:
 * the published document must print the same numbers forever and must never
 * depend on an external API at render time.
 */
export async function refreshItineraryWeather(draftId: string, localDays?: unknown): Promise<ItineraryActionResult> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };
  const record = await getDraft(draftId);
  if (!record) return { ok: false, error: "err.loadFailed" };

  const days = skeletonFor(record.data, localDays);
  // A day with no city yet still deserves weather — fall back to the trip's
  // destination so the agent is not forced to finish the cities stage first.
  const destination = (record.data.trip.destination || record.data.trip.country).trim();
  const placeFor = (d: DraftDay) => d.city_name.trim() || destination;
  const dated = days.filter((d) => d.date && placeFor(d));
  if (dated.length === 0) return { ok: false, error: "pg.itin.err.noDates" };

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
  if (readings.size === 0) return { ok: false, error: "pg.itin.err.weatherFailed" };

  // A city the provider could not resolve keeps whatever it had — a partial
  // refresh must never blank out readings that are still good.
  const next = days.map((d) => {
    const hit = d.date ? readings.get(`${placeFor(d)}|${d.date}`) : undefined;
    return hit ? { ...d, weather: hit } : d;
  });

  const saved = await saveDraftStages(draftId, { days: next });
  if (!saved.ok) return { ok: false, error: saved.error ?? "err.updateFailed" };
  return { ok: true, days: next };
}

/**
 * Draft the day text with the AI. `onlyEmpty` (the default) protects work the
 * agent already wrote — regenerating never silently overwrites a human edit.
 * The result is NOT published: every touched day is flagged `ai_generated` and
 * the agent reviews it in the stage.
 */
export async function generateItineraryDays(
  draftId: string,
  onlyEmpty = true,
  localDays?: unknown,
): Promise<ItineraryActionResult> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };
  if (!isOpenAIConfigured()) return { ok: false, error: "pg.itin.err.aiNotConfigured" };

  const record = await getDraft(draftId);
  if (!record) return { ok: false, error: "err.loadFailed" };
  const days = skeletonFor(record.data, localDays);
  if (days.length === 0) return { ok: false, error: "pg.itin.err.noDays" };

  const isEmpty = (d: DraftDay) => !d.title.trim() && d.activities.every((a) => !a.trim());
  const targets = onlyEmpty ? days.filter(isEmpty) : days;
  if (targets.length === 0) return { ok: true, days };

  const lastNumber = days[days.length - 1].day_number;
  const prompt: ItineraryPromptDay[] = targets.map((d) => ({
    day_number: d.day_number,
    date: d.date,
    city_name: d.city_name,
    marker: d.day_number === 1 ? "arrival" : d.day_number === lastNumber ? "departure" : "full",
  }));

  const result = await generateItineraryText({
    destination: record.data.trip.destination || record.data.trip.country,
    days: prompt,
    cities: itineraryCities(days),
    adults: record.data.trip.adults,
    children: record.data.trip.children,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "not_configured" ? "pg.itin.err.aiNotConfigured" : "pg.itin.err.aiFailed",
    };
  }

  const generated = new Map(result.days.map((d) => [d.day_number, d]));
  const next = days.map((d) => {
    const hit = generated.get(d.day_number);
    if (!hit) return d;
    return { ...d, title: hit.title, activities: hit.activities, ai_generated: true };
  });

  const saved = await saveDraftStages(draftId, { days: next });
  if (!saved.ok) return { ok: false, error: saved.error ?? "err.updateFailed" };
  return { ok: true, days: next };
}

// ---------- flight-number lookup ----------
export type FlightLookupActionResult =
  | { ok: true; hits: FlightLookupHit[] }
  | { ok: false; error: TranslationKey };

/**
 * Look up a flight number for the flights stage. Returns CANDIDATES only — the
 * agent picks one and it is applied to the row; nothing is written here. Times
 * come from the provider's published schedule, never from a prediction.
 */
export async function lookupFlightNumber(input: string): Promise<FlightLookupActionResult> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };
  const result = await lookupFlight(input);
  if (result.ok) return result;
  const map: Record<typeof result.error, TranslationKey> = {
    not_configured: "pg.flightLookup.err.notConfigured",
    bad_input: "pg.flightLookup.err.badInput",
    request_failed: "pg.flightLookup.err.failed",
    not_found: "pg.flightLookup.err.notFound",
  };
  return { ok: false, error: map[result.error] };
}
