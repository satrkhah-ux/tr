import { describe, expect, it } from "vitest";
import { findLookupCountry, type LookupCountry } from "./draft-types";

/**
 * The country → city cascade is only as good as the name match. A draft's
 * `trip.country` is free text (typed, copied from a past offer, or seeded from
 * the ready-offers sheet) while the countries table holds one spelling, so an
 * exact-only match shows an EMPTY city list and looks like missing data.
 */
const city = (name: string) => ({ id: name, name, hotels: [] });
const countries: LookupCountry[] = [
  { id: "1", name: "اندونيسيا", cities: [city("جاكرتا"), city("بالي")] },
  { id: "2", name: "ماليزيا", cities: [city("كوالالمبور")] },
  { id: "3", name: "جنوب أفريقيا", cities: [city("كيب تاون")] },
];

describe("findLookupCountry", () => {
  it("matches the exact name first", () => {
    expect(findLookupCountry(countries, "ماليزيا")?.id).toBe("2");
  });

  it("matches across hamza spellings — the real «إندونيسيا» vs «اندونيسيا» case", () => {
    expect(findLookupCountry(countries, "إندونيسيا")?.cities).toHaveLength(2);
    expect(findLookupCountry(countries, "أندونيسيا")?.id).toBe("1");
  });

  it("matches when the stored name carries the hamza and the draft does not", () => {
    expect(findLookupCountry(countries, "جنوب افريقيا")?.id).toBe("3");
  });

  it("ignores stray spaces and tatweel", () => {
    expect(findLookupCountry(countries, " ماليزيا ")?.id).toBe("2");
    expect(findLookupCountry(countries, "مالـيزيا")?.id).toBe("2");
  });

  it("returns undefined for an unknown country or empty input", () => {
    expect(findLookupCountry(countries, "اليابان")).toBeUndefined();
    expect(findLookupCountry(countries, "")).toBeUndefined();
  });
});
