/**
 * The countries the agency sells most come first in every country picker;
 * every other country follows in its usual (alphabetical) order.
 *
 * Ranked by the 11,434 offers issued in the legacy app.traveliun.com
 * (2024-09 → 2026-07, counted 2026-10-13 from data-import/traveliun-legacy.sql:
 * Thailand 3,242 · Indonesia 2,680 · Turkey 2,652 · Malaysia 2,488 · Vietnam 283
 * · Singapore 46 · UAE 11 · Georgia 8 · Bosnia 8). Names are ours
 * (countries.arabic_name). ponytail: a fixed list — re-rank by editing it.
 */
export const COUNTRY_PRIORITY = [
  "تايلاند",
  "اندونيسيا",
  "تركيا",
  "ماليزيا",
  "فيتنام",
  "سنغافورة",
  "الإمارات العربية المتحدة",
  "جورجيا",
  "البوسنة والهرسك",
];

/** Most-sold first; the rest keep the order they came in (the sort is stable). */
export function byUsage<T extends { name: string }>(countries: T[]): T[] {
  const rank = (name: string) => {
    const i = COUNTRY_PRIORITY.indexOf(name.trim());
    return i < 0 ? COUNTRY_PRIORITY.length : i;
  };
  return [...countries].sort((a, b) => rank(a.name) - rank(b.name));
}
