import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  currencyOptions,
  findLookupCountry,
  emptyDraftData,
  libraryForCountry,
  moveTripCountry,
  reseedForCountry,
  type DraftPricingItem,
  type LookupCountry,
  type TermLibrary,
} from "./draft-types";

/**
 * The country → city cascade is only as good as the name match. A draft's
 * `trip.country` is free text (typed, copied from a past offer, or seeded from
 * the ready-offers sheet) while the countries table holds one spelling, so an
 * exact-only match shows an EMPTY city list and looks like missing data.
 */
const city = (name: string) => ({ id: name, name, hotels: [] });
const countries: LookupCountry[] = [
  { id: "1", name: "اندونيسيا", iso2: "ID", timezone: null, cities: [city("جاكرتا"), city("بالي")] },
  { id: "2", name: "ماليزيا", iso2: "MY", timezone: null, cities: [city("كوالالمبور")] },
  // A country with no code is the case that silently breaks a live search.
  { id: "3", name: "جنوب أفريقيا", iso2: null, timezone: null, cities: [city("كيب تاون")] },
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

  it("matches a name written without the long alef — «تايلند» is «تايلاند»", () => {
    const withThailand = [...countries, { id: "4", name: "تايلاند", iso2: "TH", timezone: null, cities: [] }];
    expect(findLookupCountry(withThailand, "تايلند")?.id).toBe("4");
    // works over any { name } — the pricing lookup passes bare country rows
    expect(findLookupCountry([{ id: "th", name: "تايلاند" }], "تايلند")?.id).toBe("th");
  });

  it("returns undefined for an unknown country or empty input", () => {
    expect(findLookupCountry(countries, "اليابان")).toBeUndefined();
    expect(findLookupCountry(countries, "")).toBeUndefined();
  });
});

/**
 * «يشمل / لا يشمل / الشروط» per country. A null country_id is a global line every
 * trip may use; a country's own lines follow the trip's country — and changing
 * the country must never eat a global line or one the agent wrote.
 */
const TH = "th";
const ID = "id";
const library: TermLibrary = {
  includes: [
    { text: "الإقامة في الفنادق", checked: true, country_id: null },
    { text: "جولة الجزر", checked: true, country_id: TH },
    { text: "رحلة فيفي", checked: false, country_id: TH },
    { text: "جولة أوبود", checked: true, country_id: ID },
  ],
  excludes: [{ text: "تذاكر الطيران", checked: true, country_id: null }],
  terms: [
    { text: "الأسعار قابلة للتغيير", checked: true, country_id: null },
    { text: "رسوم المنتزهات الوطنية في تايلاند", checked: true, country_id: TH },
  ],
};

describe("libraryForCountry", () => {
  it("offers the global lines plus the country's own, never another country's", () => {
    const th = libraryForCountry(library, TH);
    expect(th.includes.map((i) => i.text)).toEqual(["الإقامة في الفنادق", "جولة الجزر", "رحلة فيفي"]);
    expect(th.terms).toHaveLength(2);
  });

  it("offers only the global lines while the trip has no country", () => {
    const none = libraryForCountry(library, null);
    expect(none.includes.map((i) => i.text)).toEqual(["الإقامة في الفنادق"]);
    expect(none.terms.map((i) => i.text)).toEqual(["الأسعار قابلة للتغيير"]);
  });
});

describe("reseedForCountry", () => {
  it("adds the country's ticked lines when the first country is chosen", () => {
    const start = { includes: ["الإقامة في الفنادق"], excludes: ["تذاكر الطيران"], terms: ["الأسعار قابلة للتغيير"] };
    const next = reseedForCountry(start, library, null, TH);
    expect(next.includes).toEqual(["الإقامة في الفنادق", "جولة الجزر"]);
    expect(next.terms).toEqual(["الأسعار قابلة للتغيير", "رسوم المنتزهات الوطنية في تايلاند"]);
    expect(next.excludes).toEqual(["تذاكر الطيران"]);
  });

  it("swaps only the old country's exact lines — global and typed lines stay", () => {
    const thai = {
      // «رحلة فيفي» was picked by hand; «جولة الجزر مع الغداء» was reworded
      includes: ["الإقامة في الفنادق", "جولة الجزر", "رحلة فيفي", "جولة الجزر مع الغداء", "شريحة اتصال"],
      excludes: ["تذاكر الطيران"],
      terms: ["الأسعار قابلة للتغيير", "رسوم المنتزهات الوطنية في تايلاند"],
    };
    const next = reseedForCountry(thai, library, TH, ID);
    expect(next.includes).toEqual(["الإقامة في الفنادق", "جولة الجزر مع الغداء", "شريحة اتصال", "جولة أوبود"]);
    expect(next.terms).toEqual(["الأسعار قابلة للتغيير"]);
    expect(next.excludes).toEqual(["تذاكر الطيران"]);
  });

  it("does not duplicate a line the agent already has, and is a no-op for the same country", () => {
    const has = { includes: ["جولة أوبود"], excludes: [], terms: [] };
    expect(reseedForCountry(has, library, TH, ID).includes).toEqual(["جولة أوبود"]);
    expect(reseedForCountry(has, library, ID, ID)).toBe(has);
  });
});

describe("moveTripCountry — the picker and the Teletel chip both go through it", () => {
  const lookups = {
    countries: [
      { id: TH, name: "تايلاند", iso2: "TH", timezone: null, cities: [] },
      { id: ID, name: "اندونيسيا", iso2: "ID", timezone: null, cities: [] },
    ],
    termLibrary: library,
    countryServices: [
      { country_id: TH, name: "تذاكر رحلة جيمس بواند" },
      { country_id: ID, name: "جولة أوبود" },
    ],
  };
  const service = (description: string, sell_price: number | null): DraftPricingItem => ({
    item_type: "service",
    description,
    quantity: 1,
    buy_price: sell_price,
    buy_currency: "THB",
    sell_price,
    sell_currency: "THB",
  });

  it("a chip on a new draft adds the country's ticked lines, even under a spelling the picker would treat as the same", () => {
    const data = emptyDraftData();
    data.services = { includes: ["الإقامة في الفنادق"], excludes: [], terms: ["الأسعار قابلة للتغيير"] };
    const next = moveTripCountry(data, lookups, { ...data.trip, country: "تايلند", destination: "تايلند" });
    expect(next.trip.country).toBe("تايلند");
    expect(next.services.includes).toEqual(["الإقامة في الفنادق", "جولة الجزر"]);
    expect(next.services.terms).toContain("رسوم المنتزهات الوطنية في تايلاند");
  });

  it("the old country's service leaves with its priced line; the agent's own lines stay", () => {
    const data = emptyDraftData();
    data.trip = { ...data.trip, country: "تايلاند", destination: "تايلاند" };
    data.services = { includes: ["جولة الجزر", "تذاكر رحلة جيمس بواند", "شريحة اتصال"], excludes: [], terms: [] };
    data.pricing = {
      ...data.pricing,
      items: [service("تذاكر رحلة جيمس بواند", 2500), service("شريحة اتصال", 600), { ...service("جولة الجزر", 900), item_type: "other" }],
    };
    const next = moveTripCountry(data, lookups, { ...data.trip, country: "اندونيسيا", destination: "اندونيسيا" });
    expect(next.services.includes).toEqual(["شريحة اتصال", "جولة أوبود"]);
    // only a «خدمة» line for a line that left — the typed one and other kinds stay
    expect(next.pricing.items.map((i) => i.description)).toEqual(["شريحة اتصال", "جولة الجزر"]);
  });

  it("changes nothing but the trip when the country stays the same", () => {
    const data = emptyDraftData();
    data.trip = { ...data.trip, country: "تايلاند" };
    data.services = { includes: ["تذاكر رحلة جيمس بواند"], excludes: [], terms: [] };
    data.pricing = { ...data.pricing, items: [service("تذاكر رحلة جيمس بواند", 2500)] };
    const next = moveTripCountry(data, lookups, { ...data.trip, country: "تايلند" });
    expect(next.services).toBe(data.services);
    expect(next.pricing).toBe(data.pricing);
  });
});

describe("currencyOptions — one list for every currency dropdown", () => {
  it("adds each country's own currency after the base set, once", () => {
    const options = currencyOptions([{ default_currency: "GEL" }, { default_currency: "THB" }, { default_currency: null }, {}]);
    expect(options.slice(0, CURRENCIES.length)).toEqual([...CURRENCIES]);
    expect(options.filter((c) => c === "THB")).toHaveLength(1);
    expect(options).toContain("GEL");
  });
  it("keeps the line's own code, so an SGD line never shows as SAR", () => {
    expect(currencyOptions([], "sgd", null, "")).toEqual([...CURRENCIES, "SGD"]);
  });
  it("ignores anything that is not a currency code", () => {
    expect(currencyOptions([{ default_currency: "ريال سعودي" }], "X1")).toEqual([...CURRENCIES]);
  });
});
