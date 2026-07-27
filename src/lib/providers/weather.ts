import "server-only";

/**
 * Per-day weather for an itinerary — Open-Meteo (FREE, no API key).
 *
 * HONESTY IS THE POINT: a real forecast only exists ~16 days out, but travel
 * programs are usually months away. So each day is labelled with its source:
 *   • "forecast" — an actual forecast for that date;
 *   • "normals"  — the CLIMATE AVERAGE for that calendar day, computed from the
 *     same day-of-year across the last few years.
 * We never present an average as a forecast; the document prints the label.
 *
 * Endpoints (all keyless):
 *   geocoding-api.open-meteo.com/v1/search   → city → lat/lon
 *   api.open-meteo.com/v1/forecast           → ≤16 days ahead
 *   archive-api.open-meteo.com/v1/archive    → historical, for the normals
 */

import { formatWeatherAr, weatherCodeAr } from "@/lib/offer/weather-format";

export { weatherCodeAr };

export type WeatherSource = "forecast" | "normals";

export type DayWeather = {
  /** YYYY-MM-DD (the itinerary day). */
  date: string;
  /** °C, rounded. */
  tempMax: number | null;
  tempMin: number | null;
  /** 0-100. Forecast: probability of precipitation. Normals: share of past
   *  years that were wet on this day (a comparable "how likely is rain"). */
  rainChance: number | null;
  /** WMO weather code (forecast only — normals have no single code). */
  code: number | null;
  source: WeatherSource;
};

export type CityWeather = {
  city: string;
  /** resolved place name from geocoding (helps the agent spot a wrong match). */
  resolvedName: string | null;
  days: DayWeather[];
};

// ---------- pure helpers (unit-tested) ----------

/** Days from `today` a date is; negative for the past. Pure UTC arithmetic. */
export function daysAhead(date: string, today: string): number {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((a - b) / 86_400_000);
}

/** Open-Meteo serves a real forecast for ~16 days; beyond that we use normals. */
export const FORECAST_HORIZON_DAYS = 16;

/** Split itinerary dates into the forecastable ones and the rest. */
export function splitDatesByHorizon(
  dates: string[],
  today: string,
): { forecast: string[]; normals: string[] } {
  const forecast: string[] = [];
  const normals: string[] = [];
  for (const date of dates) {
    const ahead = daysAhead(date, today);
    if (Number.isFinite(ahead) && ahead >= 0 && ahead <= FORECAST_HORIZON_DAYS) forecast.push(date);
    else normals.push(date);
  }
  return { forecast, normals };
}

/** How many past years the climate normals average over. */
export const NORMALS_YEARS = 5;

/** The same calendar day in each of the previous `years` years (YYYY-MM-DD). */
export function historicalDatesFor(date: string, years = NORMALS_YEARS): string[] {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return [];
  const year = Number(m[1]);
  const out: string[] = [];
  for (let i = 1; i <= years; i += 1) out.push(`${year - i}-${m[2]}-${m[3]}`);
  return out;
}

/**
 * Shift a date back `years` years, padded by `padDays` on each side, as a
 * REAL calendar date — so 2026-02-29 never yields an invalid 2025-02-29 that
 * the archive API would reject. The padding also guarantees the wanted
 * month-day is inside the range even after such a normalisation.
 */
export function shiftYears(date: string, years: number, padDays = 0): string | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]) - years, Number(m[2]) - 1, Number(m[3]) + padDays));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function mean(values: number[]): number | null {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function round(v: number | null): number | null {
  return v == null ? null : Math.round(v);
}

/**
 * Average past years into one normals entry. `rain` values are daily precip in
 * mm; a day counts as "wet" at ≥1mm, so the share of wet years reads as a
 * rain likelihood comparable to the forecast's probability.
 */
export function averageNormals(
  date: string,
  samples: { tmax: number | null; tmin: number | null; rain: number | null }[],
): DayWeather {
  const rains = samples.map((s) => s.rain).filter((v): v is number => typeof v === "number");
  const wetShare = rains.length > 0 ? (rains.filter((v) => v >= 1).length / rains.length) * 100 : null;
  return {
    date,
    tempMax: round(mean(samples.map((s) => s.tmax).filter((v): v is number => typeof v === "number"))),
    tempMin: round(mean(samples.map((s) => s.tmin).filter((v): v is number => typeof v === "number"))),
    rainChance: round(wetShare),
    code: null,
    source: "normals",
  };
}

/** One-line Arabic summary — shares the client-safe formatter with the document. */
export function summarizeAr(day: DayWeather): string {
  return formatWeatherAr({
    temp_max: day.tempMax,
    temp_min: day.tempMin,
    rain_chance: day.rainChance,
    code: day.code,
    source: day.source,
    fetched_at: "",
  });
}

// ---------- network (server-only) ----------

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type GeoResult = { results?: { name: string; latitude: number; longitude: number; country?: string }[] };

/** City name → coordinates. Arabic names work; falls back to the raw query. */
export async function geocodeCity(city: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const q = city.trim();
  if (!q) return null;
  const data = await getJson<GeoResult>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=ar&format=json`,
  );
  const hit = data?.results?.[0];
  if (!hit) return null;
  return { lat: hit.latitude, lon: hit.longitude, name: hit.country ? `${hit.name} — ${hit.country}` : hit.name };
}

type DailyBlock = {
  daily?: {
    time?: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
    precipitation_sum?: (number | null)[];
    weather_code?: (number | null)[];
  };
};

/** Real forecast for dates inside the horizon. */
async function fetchForecast(lat: number, lon: number, dates: string[]): Promise<DayWeather[]> {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&timezone=auto&start_date=${sorted[0]}&end_date=${sorted[sorted.length - 1]}`;
  const data = await getJson<DailyBlock>(url);
  const d = data?.daily;
  if (!d?.time) return [];
  const wanted = new Set(dates);
  const out: DayWeather[] = [];
  d.time.forEach((date, i) => {
    if (!wanted.has(date)) return;
    out.push({
      date,
      tempMax: round(d.temperature_2m_max?.[i] ?? null),
      tempMin: round(d.temperature_2m_min?.[i] ?? null),
      rainChance: round(d.precipitation_probability_max?.[i] ?? null),
      code: d.weather_code?.[i] ?? null,
      source: "forecast",
    });
  });
  return out;
}

type Sample = { tmax: number | null; tmin: number | null; rain: number | null };

/**
 * Climate normals for far-future dates: pull the SAME calendar span from each of
 * the last few years. One request PER YEAR (each only as long as the trip) —
 * a single request spanning all the years would download ~5 years of daily rows
 * to use a handful of them.
 */
async function fetchNormals(lat: number, lon: number, dates: string[]): Promise<DayWeather[]> {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const years = await Promise.all(
    Array.from({ length: NORMALS_YEARS }, (_, i) => i + 1).map(async (back) => {
      // ±1 day of padding keeps the wanted month-day inside the range even when
      // a Feb-29 start normalises forward into March.
      const start = shiftYears(first, back, -1);
      const end = shiftYears(last, back, 1);
      if (!start || !end) return null;
      const url =
        `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
        `&timezone=auto&start_date=${start}&end_date=${end}`;
      return getJson<DailyBlock>(url);
    }),
  );

  const byDate = new Map<string, Sample>();
  for (const data of years) {
    const d = data?.daily;
    if (!d?.time) continue;
    d.time.forEach((date, i) => {
      byDate.set(date, {
        tmax: d.temperature_2m_max?.[i] ?? null,
        tmin: d.temperature_2m_min?.[i] ?? null,
        rain: d.precipitation_sum?.[i] ?? null,
      });
    });
  }

  return dates.map((date) => {
    const samples = historicalDatesFor(date)
      .map((past) => byDate.get(past))
      .filter((v): v is Sample => Boolean(v));
    return averageNormals(date, samples);
  });
}

/**
 * Weather for one city across the given itinerary dates. Each day is forecast
 * or normals depending on how far away it is. Returns [] on any failure — the
 * program still prints, just without the weather line.
 */
export async function getCityWeather(city: string, dates: string[], today?: string): Promise<CityWeather> {
  const empty: CityWeather = { city, resolvedName: null, days: [] };
  const unique = [...new Set(dates.filter(Boolean))].sort();
  if (unique.length === 0) return empty;

  const place = await geocodeCity(city);
  if (!place) return empty;

  const ref = today ?? new Date().toISOString().slice(0, 10);
  const { forecast, normals } = splitDatesByHorizon(unique, ref);
  const [f, n] = await Promise.all([
    fetchForecast(place.lat, place.lon, forecast),
    fetchNormals(place.lat, place.lon, normals),
  ]);

  const merged = [...f, ...n].sort((a, b) => a.date.localeCompare(b.date));
  return { city, resolvedName: place.name, days: merged };
}
