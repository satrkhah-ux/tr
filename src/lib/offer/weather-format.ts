/**
 * Weather → Arabic text. PURE and client-safe on purpose: the same formatting
 * has to run in the live preview (browser), in the printed document (server)
 * and in the itinerary stage, so it cannot live in the server-only provider.
 *
 * The source label is not decoration — a climate average must never read as a
 * forecast, so every rendering of a reading carries where it came from.
 */

import type { DayWeatherSnapshot } from "./draft-types";

/** WMO weather code → short Arabic description. */
export function weatherCodeAr(code: number | null): string {
  if (code == null) return "";
  if (code === 0) return "صحو";
  if (code <= 2) return "غائم جزئيًا";
  if (code === 3) return "غائم";
  if (code <= 48) return "ضباب";
  if (code <= 57) return "رذاذ";
  if (code <= 67) return "أمطار";
  if (code <= 77) return "ثلوج";
  if (code <= 82) return "زخّات مطر";
  if (code <= 86) return "زخّات ثلج";
  return "عواصف رعدية";
}

/** Where the reading came from — printed next to every temperature. */
export function weatherSourceAr(source: DayWeatherSnapshot["source"]): string {
  return source === "forecast" ? "توقّع" : "معدّل مناخي";
}

export function weatherSourceEn(source: DayWeatherSnapshot["source"]): string {
  return source === "forecast" ? "forecast" : "climate average";
}

/** "32° / 24°" — the temperature pair, or "" when we have no numbers. */
export function formatTempsAr(w: Pick<DayWeatherSnapshot, "temp_max" | "temp_min">): string {
  if (w.temp_max != null && w.temp_min != null) return `${w.temp_max}° / ${w.temp_min}°`;
  if (w.temp_max != null) return `${w.temp_max}°`;
  if (w.temp_min != null) return `${w.temp_min}°`;
  return "";
}

/** "86% احتمال مطر" for a forecast, "40% أيام ممطرة" for an average. */
export function formatRainAr(w: Pick<DayWeatherSnapshot, "rain_chance" | "source">): string {
  if (w.rain_chance == null) return "";
  return `${w.rain_chance}% ${w.source === "forecast" ? "احتمال مطر" : "أيام ممطرة"}`;
}

/** Full one-line summary: "32° / 24° · زخّات مطر · 86% احتمال مطر". */
export function formatWeatherAr(w: DayWeatherSnapshot | null): string {
  if (!w) return "";
  return [formatTempsAr(w), weatherCodeAr(w.code), formatRainAr(w)].filter(Boolean).join(" · ");
}

/** True when a reading carries no numbers at all — nothing worth printing. */
export function isWeatherEmpty(w: DayWeatherSnapshot | null): boolean {
  return !w || (w.temp_max == null && w.temp_min == null && w.rain_chance == null);
}
