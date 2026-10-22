"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentCanOpen } from "@/lib/roles/current";
import { resolvePlace } from "@/lib/leads/places";
import { normalizeName } from "@/lib/offer/pricing-suggest";

/**
 * «ابحث عن دولة أو خدمة» (the owner, 2026-10-22: «امكانية البحث عن الدول و
 * الخدمات»): a country, a city or a service, typed in either script, and what
 * the data holds for it in one place — each figure a link to its page filtered.
 * A country or a city by its catalogue name, Arabic or English, else by the
 * spellings «العملاء» knows (resolvePlace: تايلند، بالي، يلوا…). Read-only, with
 * the viewer's own session.
 */

export type PlaceCounts = { cities: number; hotels: number; tours: number; transfers: number; services: number; visas: number; guide: boolean };
export type DataHit =
  | { kind: "country"; id: string; name: string; counts: PlaceCounts }
  | { kind: "city"; id: string; name: string; countryId: string | null; country: string; counts: Pick<PlaceCounts, "hotels" | "tours"> };
export type ServiceHit = { countryId: string | null; country: string; count: number };
export type DataSearch = { places: DataHit[]; services: ServiceHit[] };

type Named = { id: string; arabic_name: string; english_name: string | null };
const fold = (s: string | null | undefined) => normalizeName(s).replace(/[^\p{L}\p{N}]+/gu, "");
/** English names the catalogue spells otherwise («Turkiye») */
const ENGLISH: Record<string, string> = { turkey: "تركيا", england: "المملكة المتحدة", britain: "المملكة المتحدة", usa: "الولايات المتحدة" };

export async function searchData(query: string): Promise<DataSearch> {
  const empty: DataSearch = { places: [], services: [] };
  const q = fold(query);
  if (q.length < 2 || !(await currentCanOpen("/data-search"))) return empty;
  try {
    const db = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const [{ data: countryRows }, { data: cityRows }] = await Promise.all([
      db.from("countries").select("id, arabic_name, english_name"),
      db.from("cities").select("id, arabic_name, english_name, country_id").limit(5000),
    ]);
    const countries = (countryRows ?? []) as Named[];
    const cities = (cityRows ?? []) as (Named & { country_id: string | null })[];
    const hits = (n: Named) => [fold(n.arabic_name), fold(n.english_name)].some((v) => v && (v.includes(q) || (v.length >= 3 && q.includes(v))));
    let foundCountries = countries.filter((c) => hits(c) || ENGLISH[q] === c.arabic_name);
    let foundCities = cities.filter(hits);
    if (foundCountries.length === 0 && foundCities.length === 0) {
      // the spellings clients write and the catalogue lacks
      const r = resolvePlace(query, [...countries.map((c) => ({ name: c.arabic_name, country: c.arabic_name })), ...cities.map((c) => ({ name: c.arabic_name, country: countries.find((k) => k.id === c.country_id)?.arabic_name ?? "" }))]);
      if (r.kind === "destination") {
        foundCountries = countries.filter((c) => c.arabic_name === r.country);
        if (r.city) foundCities = cities.filter((c) => fold(c.arabic_name) === fold(r.city));
      }
    }
    const count = async (table: string, column: string, value: string) => (await db.from(table).select(column, { count: "exact", head: true }).eq(column, value)).count ?? 0;
    const countryName = (id: string | null) => countries.find((c) => c.id === id)?.arabic_name ?? "—";

    const places: DataHit[] = [
      ...(await Promise.all(
        foundCountries.slice(0, 3).map(async (c) => {
          const [nCities, hotels, tours, transfers, services, visas, guide] = await Promise.all([
            count("cities", "country_id", c.id),
            count("hotels", "country_id", c.id),
            count("tours", "country_id", c.id),
            count("transfers", "country_id", c.id),
            count("services", "country_id", c.id),
            count("visas", "country_id", c.id),
            count("destination_guides", "country_id", c.id),
          ]);
          return { kind: "country" as const, id: c.id, name: c.arabic_name, counts: { cities: nCities, hotels, tours, transfers, services, visas, guide: guide > 0 } };
        }),
      )),
      ...(await Promise.all(
        foundCities.slice(0, 6).map(async (c) => {
          const [hotels, tours] = await Promise.all([count("hotels", "city_id", c.id), count("tours", "city_id", c.id)]);
          return { kind: "city" as const, id: c.id, name: c.arabic_name, countryId: c.country_id, country: countryName(c.country_id), counts: { hotels, tours } };
        }),
      )),
    ];

    // a service by its name or its kind, counted by country
    const term = query.trim().replace(/[%,()]/g, " ").slice(0, 60);
    const { data: serviceRows } = await db
      .from("services")
      .select("country_id")
      .or(`arabic_name.ilike.%${term}%,english_name.ilike.%${term}%,service_type.ilike.%${term}%`)
      .limit(500);
    const byCountry = new Map<string | null, number>();
    for (const s of (serviceRows ?? []) as { country_id: string | null }[]) byCountry.set(s.country_id, (byCountry.get(s.country_id) ?? 0) + 1);
    const services = [...byCountry.entries()].map(([countryId, n]) => ({ countryId, country: countryName(countryId), count: n })).sort((a, b) => b.count - a.count);
    return { places, services };
  } catch {
    return empty;
  }
}
