import { hopMode, type DraftData, type GeneratorLookups } from "./draft-types";

/**
 * An overland hop nobody would drive.
 *
 * AD-4-8573 sold Puncak → Bali «براً بسيارة صغيرة»: 20+ hours with a ferry. A
 * warning, never a block and never a price change — the agent may know a route
 * we do not — saying the distance and suggesting a domestic flight.
 *
 * Two signals: the great-circle distance between the catalogue's coordinates
 * (cities.lat/lng) times a road factor, and a short list of cities on an island
 * of their own, so a hop to one is flagged even when a coordinate is missing.
 */

type Point = { lat: number; lng: number };

/** Great-circle distance in km (haversine). */
export function greatCircleKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Roads are not straight lines: the usual detour factor. */
export const ROAD_FACTOR = 1.3;
/** Past this by road a hop is a lost day in a car — a domestic flight is the sane offer. */
export const MAX_ROAD_KM = 600;

/**
 * Catalogue cities (Arabic name) on an island the road does not reach — a ferry
 * at best. Unlisted is «the mainland»; Penang, Phuket and Sentosa are joined by a
 * bridge or causeway, so they are not here.
 */
const ISLAND: Record<string, string> = {
  بالي: "bali",
  لومبوك: "lombok",
  "جزيرة جيلي": "gili",
  لنكاوي: "langkawi",
  بانكور: "pangkor",
  "كوتا كينابالو": "borneo",
  "كوه ساموي": "samui",
  "جزر في في تايلاند": "phiphi",
  "كو ياو ياي": "yaoyai",
  "فو كوك": "phuquoc",
  جيجو: "jeju",
  سانتوريني: "santorini",
};

export type OverlandHop = {
  from: string;
  to: string;
  /** estimated road km; null when a coordinate is missing. */
  km: number | null;
  /** the hop crosses the sea (an island list match). */
  sea: boolean;
};

/** Each catalogue city's coordinates, by its name. */
export function cityPoints(countries: GeneratorLookups["countries"]): Map<string, Point> {
  const points = new Map<string, Point>();
  for (const country of countries) {
    for (const c of country.cities) if (c.lat != null && c.lng != null) points.set(c.name.trim(), { lat: c.lat, lng: c.lng });
  }
  return points;
}

/**
 * The road hops (the printed «الانتقال إلى … — سيارة») that cross the sea or run
 * past MAX_ROAD_KM. A hop a domestic flight already lands is not a road hop.
 */
export function implausibleOverlandHops(
  data: Pick<DraftData, "cities" | "transport_plan" | "flights" | "scope">,
  points: Map<string, Point>,
): OverlandHop[] {
  if (!data.scope.transport || !data.transport_plan.intercity.enabled) return [];
  const out: OverlandHop[] = [];
  data.cities.forEach((city, i) => {
    if (i === 0) return;
    const from = data.cities[i - 1].city_name.trim();
    const to = city.city_name.trim();
    if (!from || !to || from === to || hopMode(data.transport_plan, from, to) !== "car") return;
    if (data.flights.some((f) => f.leg_order === "internal" && f.to_city?.trim() === to)) return;
    const a = points.get(from);
    const b = points.get(to);
    const km = a && b ? Math.round(greatCircleKm(a, b) * ROAD_FACTOR) : null;
    const sea = (ISLAND[from] ?? "") !== (ISLAND[to] ?? "");
    if (sea || (km != null && km > MAX_ROAD_KM)) out.push({ from, to, km, sea });
  });
  return out;
}
