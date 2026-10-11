/**
 * Pick the right place out of a geocoder's answer.
 *
 * Open-Meteo returns fuzzy matches first: «Langkawi» comes back as
 * «Langkawit», a village in Sabah 1,800 km away, ahead of «Langkawi Islands».
 * So a hit must actually be named what was asked, and a real town beats an
 * empty hamlet of the same name.
 *
 * Pure (the scripts import it too).
 */

export type GeoHit = {
  name: string;
  latitude: number;
  longitude: number;
  feature_code?: string;
  population?: number;
  country?: string;
  country_code?: string;
};

/** Lower is better. */
function featureRank(code: string | undefined, population: number): number {
  if (population > 0 && /^PPL/.test(code ?? "")) return 0;
  if (/^(ISL|ISLS|ADM1|ADM2|AREA|RGN)$/.test(code ?? "")) return 1;
  if (/^PPL/.test(code ?? "")) return 2;
  if (code === "AIRP") return 3;
  return 4;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function bestGeoHit(query: string, hits: GeoHit[]): GeoHit | null {
  const q = fold(query);
  if (!q) return null;
  // «Langkawit» does not count as «Langkawi»: a whole-word match only.
  const named = hits.filter((h) => {
    const n = fold(h.name);
    return n === q || n.startsWith(`${q} `) || n.endsWith(` ${q}`) || q.startsWith(`${n} `);
  });
  if (named.length === 0) return null;
  return [...named].sort(
    (a, b) =>
      featureRank(a.feature_code, a.population ?? 0) - featureRank(b.feature_code, b.population ?? 0) ||
      (b.population ?? 0) - (a.population ?? 0),
  )[0];
}
