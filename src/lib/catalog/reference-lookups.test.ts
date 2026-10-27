import { describe, expect, it } from "vitest";
import type { LookupCountry } from "@/lib/offer/draft-types";
import { withCatalogAdditions } from "./reference-lookups";

describe("inline catalogue additions", () => {
  const country: LookupCountry = { id: "ge", name: "جورجيا", iso2: "GE", timezone: "Asia/Tbilisi", default_currency: "GEL", cities: [] };

  it("keeps existing countries and appends a city to its newly added country", () => {
    const base = { countries: [country], untouched: "draft remains" };
    const next = withCatalogAdditions(base,
      [{ id: "fr", arabic_name: "فرنسا", default_currency: "EUR" }],
      [{ id: "paris", arabic_name: "باريس", country_id: "fr", lat: 0, lng: null }]);
    expect(next.countries[0]).toEqual(country);
    expect(next.countries[1].cities[0]).toEqual({ id: "paris", name: "باريس", lat: 0, lng: null, hotels: [] });
    expect(next.untouched).toBe("draft remains");
    expect(base.countries).toHaveLength(1);
  });

  it("does not replace authoritative server fields or duplicate a refreshed addition", () => {
    const city = { id: "tb", name: "تبليسي", lat: 41, lng: 44, hotels: [] };
    const next = withCatalogAdditions({ countries: [{ ...country, cities: [city] }] },
      [{ id: "ge", arabic_name: "جورجيا" }], [{ id: "tb", country_id: "ge", arabic_name: "تبليسي" }]);
    expect(next.countries).toHaveLength(1);
    expect(next.countries[0].timezone).toBe("Asia/Tbilisi");
    expect(next.countries[0].cities).toEqual([city]);
  });
});
