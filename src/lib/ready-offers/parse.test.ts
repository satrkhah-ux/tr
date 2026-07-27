import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  codeFor,
  matchHotelsToCities,
  normalizeDigits,
  parseCities,
  parseCsv,
  parseDuration,
  parseList,
  parsePrice,
  parseSheet,
  parseValidity,
} from "./parse";
import { buildSeed, hasDomesticFlight } from "./types";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");

const YEAR = 2026;
const economy = parseSheet(fixture("economy.csv"), "economy", YEAR);
const premium = parseSheet(fixture("premium.csv"), "premium", YEAR);
const find = (offers: typeof economy.offers, title: string) =>
  offers.find((o) => o.title.includes(title));

describe("parseCsv", () => {
  it("keeps commas inside quoted cells", () => {
    expect(parseCsv('a,"4,599",b')[0]).toEqual(["a", "4,599", "b"]);
  });

  it("keeps newlines inside quoted cells", () => {
    const rows = parseCsv('a,"line1\nline2",c\nnext,row,here');
    expect(rows).toHaveLength(2);
    expect(rows[0][1]).toBe("line1\nline2");
    expect(rows[1][0]).toBe("next");
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('x,"say ""hi"""')[0][1]).toBe('say "hi"');
  });
});

describe("scalar parsers", () => {
  it("converts Eastern digits", () => {
    expect(normalizeDigits("٨ أيام ٧ ليالي")).toBe("8 أيام 7 ليالي");
  });

  it("reads durations in either order and either digit script", () => {
    expect(parseDuration("7 ليالي 8 أيام")).toEqual({ days: 8, nights: 7 });
    expect(parseDuration("10 أيام / 9 ليالي")).toEqual({ days: 10, nights: 9 });
    expect(parseDuration("٧ أيام / ٦ ليالي")).toEqual({ days: 7, nights: 6 });
    expect(parseDuration("١١ يوم ١٠ ليالي")).toEqual({ days: 11, nights: 10 });
    expect(parseDuration("")).toEqual({ days: null, nights: null });
  });

  it("strips thousands separators from the price", () => {
    expect(parsePrice("4,599")).toBe(4599);
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("—")).toBeNull();
  });

  it("resolves validity windows including the sheet's typos", () => {
    expect(parseValidity("مايو - اغسطس", YEAR)).toEqual({ from: "2026-05-01", to: "2026-08-31" });
    expect(parseValidity("ابريل ومايو", YEAR)).toEqual({ from: "2026-04-01", to: "2026-05-31" });
    expect(parseValidity("June-Aug", YEAR)).toEqual({ from: "2026-06-01", to: "2026-08-31" });
    expect(parseValidity("Julay", YEAR)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(parseValidity("حسب التوفر", YEAR)).toBeNull();
  });

  it("splits include lists written either way", () => {
    expect(parseList("فنادق + إفطار + سيارة خاصة")).toEqual(["فنادق", "إفطار", "سيارة خاصة"]);
    expect(parseList("✔ فنادق 4★\n✔ الطيران الداخلي")).toEqual(["فنادق 4★", "الطيران الداخلي"]);
    expect(parseList("")).toEqual([]);
  });

  it("detects whether a domestic flight exists", () => {
    expect(hasDomesticFlight("❌ لا يوجد")).toBe(false);
    expect(hasDomesticFlight("لايوجد")).toBe(false);
    expect(hasDomesticFlight("")).toBe(false);
    expect(hasDomesticFlight("جاكرتا → بالي، 20 كجم + 7 كجم")).toBe(true);
  });
});

describe("parseCities", () => {
  it("reads the night count before or after the city name", () => {
    expect(parseCities("كوالالمبور 7")).toEqual([{ city_name: "كوالالمبور", nights: 7 }]);
    expect(parseCities("1 جاكرتا – 7 بالي – 1 جاكرتا")).toEqual([
      { city_name: "جاكرتا", nights: 1 },
      { city_name: "بالي", nights: 7 },
      { city_name: "جاكرتا", nights: 1 },
    ]);
  });

  it("keeps a repeated city as two separate stays", () => {
    expect(parseCities("هانوي 2 + سابا 2 + هانوي 3")).toEqual([
      { city_name: "هانوي", nights: 2 },
      { city_name: "سابا", nights: 2 },
      { city_name: "هانوي", nights: 3 },
    ]);
  });

  it("refuses to guess when any segment has no nights", () => {
    expect(parseCities("سيول- بوسان- جيجو- سيول")).toBeNull();
    expect(parseCities("طرابزون - زيارة حيدر نبي- زيارة زيغانا")).toBeNull();
    expect(parseCities("موسكو")).toBeNull();
    expect(parseCities("")).toBeNull();
  });
});

describe("matchHotelsToCities", () => {
  const cities = [
    { city_name: "هانوي", nights: 2 },
    { city_name: "دانانغ", nights: 3 },
  ];

  it("matches labelled lines to their city", () => {
    const out = matchHotelsToCities("هانوي: Oriental Suites\nدانانغ: Fivitel Da Nang", cities);
    expect(out).toEqual(["Oriental Suites", "Fivitel Da Nang"]);
  });

  it("splits in order when the count matches", () => {
    expect(matchHotelsToCities("Oriental Suites + Fivitel", cities)).toEqual(["Oriental Suites", "Fivitel"]);
  });

  it("falls back to the full text rather than dropping information", () => {
    const raw = "A + B + C";
    expect(matchHotelsToCities(raw, cities)).toEqual([raw, raw]);
  });
});

describe("codeFor", () => {
  it("is stable for the same identity and distinct per duration", () => {
    const a = codeFor("economy", "ماليزيا", null, "كوالالمبور 7", "7 ليالي 8 أيام");
    expect(codeFor("economy", "ماليزيا ", null, "كوالالمبور 7", "7 ليالي 8 أيام")).toBe(a);
    // جنوب افريقيا ships the same destination + cities cell at two lengths
    const nine = codeFor("premium", "جنوب افريقيا", null, "كيب تاون", "٩ أيام ٨ ليالي");
    const eleven = codeFor("premium", "جنوب افريقيا", null, "كيب تاون", "١١ يوم ١٠ ليالي");
    expect(nine).not.toBe(eleven);
  });

  it("namespaces by tier", () => {
    expect(codeFor("economy", "دبي", null, "", "")).not.toBe(codeFor("premium", "دبي", null, "", ""));
  });
});

describe("the real economy sheet", () => {
  it("parses every row and skips the notes footer", () => {
    expect(economy.errors).toEqual([]);
    expect(economy.offers).toHaveLength(10);
    expect(economy.offers.some((o) => o.country.startsWith("ملاحظ"))).toBe(false);
  });

  it("reads the Malaysia package end to end", () => {
    const my = find(economy.offers, "ماليزيا");
    expect(my).toBeDefined();
    expect(my!.price).toBe(4599);
    expect(my!.currency).toBe("SAR");
    expect(my!.days).toBe(8);
    expect(my!.nights).toBe(7);
    expect(my!.status).toBe("ready");
    expect(my!.cities).toEqual([{ city_name: "كوالالمبور", nights: 7 }]);
    expect(my!.valid_from).toBe("2026-05-01");
    expect(my!.valid_to).toBe("2026-08-31");
    expect(my!.includes).toContain("إفطار");
    expect(my!.excludes.length).toBeGreaterThan(0);
  });

  it("marks the announced-but-unpriced rows as coming_soon", () => {
    const soon = economy.offers.filter((o) => o.status === "coming_soon").map((o) => o.country);
    expect(soon).toEqual(expect.arrayContaining(["إسطنبول", "موسكو", "دبي", "القاهرة"]));
    expect(economy.offers.filter((o) => o.status === "ready")).toHaveLength(6);
  });

  it("uses the row's own validity window, not a blanket one", () => {
    expect(find(economy.offers, "القاهرة")!.valid_to).toBe("2026-05-31");
  });
});

describe("the real premium sheet", () => {
  it("parses without errors", () => {
    expect(premium.errors).toEqual([]);
    expect(premium.offers.length).toBeGreaterThan(10);
  });

  it("separates the Vietnam variants", () => {
    const vietnam = premium.offers.filter((o) => o.country.startsWith("فيتنام"));
    expect(vietnam.length).toBeGreaterThanOrEqual(2);
    expect(vietnam.map((o) => o.variant)).toContain("الباقة المتوسطة");
    expect(new Set(vietnam.map((o) => o.code)).size).toBe(vietnam.length);
  });

  it("reads Eastern-digit durations", () => {
    const russia = premium.offers.find((o) => o.country === "روسيا");
    expect(russia).toBeDefined();
    expect(russia!.days).toBe(7);
    expect(russia!.nights).toBe(6);
  });

  it("refuses the city split when the sheet's nights do not add up", () => {
    const thai = premium.offers.find((o) => o.cities_summary.includes("بانكوك"));
    expect(thai).toBeDefined();
    expect(thai!.cities).toBeNull();
    expect(thai!.warnings.join(" ")).toContain("مجموع ليالي المدن");
  });
});

describe("catalog-wide invariants", () => {
  const all = [...economy.offers, ...premium.offers];

  it("gives every row a unique code", () => {
    expect(new Set(all.map((o) => o.code)).size).toBe(all.length);
  });

  it("never seeds cities whose nights disagree with the trip", () => {
    for (const o of all) {
      if (!o.cities) continue;
      expect(o.cities.reduce((s, c) => s + c.nights, 0)).toBe(o.nights);
    }
  });

  it("aligns the per-city hotel list with the cities", () => {
    for (const o of all) {
      expect(o.hotels_by_city).toHaveLength(o.cities?.length ?? 0);
    }
  });
});

describe("buildSeed", () => {
  const my = find(economy.offers, "ماليزيا")!;
  const seed = buildSeed(my, "ro-1");

  it("locks the company price via pricing.final_total", () => {
    expect(seed.pricing?.final_total).toBe(4599);
    expect(seed.pricing?.items).toEqual([]);
    expect(seed.pricing?.display_currency).toBe("SAR");
  });

  it("seeds cities and name-only hotel shells with no supplier sourcing", () => {
    expect(seed.cities).toEqual([{ city_name: "كوالالمبور", nights: 7, check_in: null, check_out: null }]);
    expect(seed.hotels).toHaveLength(1);
    expect(seed.hotels![0].hotel_name).toContain("Royal Signature");
    expect(seed.hotels![0]).not.toHaveProperty("sourcing");
    expect(seed.hotels![0].hotel_id).toBeNull();
  });

  it("leaves the salesperson's fields empty", () => {
    expect(seed.customer).toBeUndefined();
    expect(seed.trip?.arrival_date).toBeNull();
    expect(seed.days).toBeUndefined();
  });

  it("carries management's standing terms", () => {
    expect(seed.services?.terms.join(" ")).toContain("تابي وتمارا");
    expect(seed.services?.terms.join(" ")).toContain("خدمات اختيارية");
  });

  it("adds the domestic-flight refund clause only when there is one", () => {
    const clause = "الطيران الداخلي غير قابل للاسترجاع";
    expect(seed.services?.terms.join(" ")).not.toContain(clause);
    const withFlight = premium.offers.find((o) => hasDomesticFlight(o.domestic_flight));
    expect(withFlight).toBeDefined();
    expect(buildSeed(withFlight!, "ro-2").services?.terms.join(" ")).toContain(clause);
  });

  it("records the source so the draft can warn about the season window", () => {
    expect(seed.source?.ready_offer_id).toBe("ro-1");
    expect(seed.source?.tier).toBe("economy");
    expect(seed.source?.valid_to).toBe("2026-08-31");
  });
});
