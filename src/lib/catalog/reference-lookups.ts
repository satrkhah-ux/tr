import type { DataRow } from "@/lib/data/types";
import type { GeneratorLookups, LookupCountry } from "@/lib/offer/draft-types";

/** Additions are local immediately; a subsequent server refresh takes over by id. */
export function withCatalogAdditions<T extends Pick<GeneratorLookups, "countries">>(base: T, countries: DataRow[], cities: DataRow[]): T {
  const added: LookupCountry[] = countries.filter(r => !base.countries.some(c => c.id === r.id)).map(r => ({
    id: String(r.id), name: String(r.arabic_name), iso2: typeof r.iso2 === "string" ? r.iso2 : null,
    timezone: typeof r.timezone === "string" ? r.timezone : null,
    default_currency: typeof r.default_currency === "string" ? r.default_currency : null, cities: [],
  }));
  return { ...base, countries: [...base.countries, ...added].map(country => ({
    ...country, cities: [...country.cities, ...cities.filter(r => r.country_id === country.id && !country.cities.some(c => c.id === r.id)).map(r => ({
      id: String(r.id), name: String(r.arabic_name), hotels: [],
      lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng),
    }))],
  })) };
}
