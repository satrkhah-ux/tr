import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  currencyOf,
  matchHotelsToCities,
  normalizeDigits,
  parseCities,
  parseCityNights,
  parseCsv,
  parseDuration,
  parseList,
  parseParty,
  parsePrice,
  parseValidity,
  parseWorkbook,
  tabsFromHtml,
} from "./parse";
import { buildSeed, canStartFrom, hasDomesticFlight } from "./types";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");

const YEAR = 2026;
// the owner's sheet of 2026-10-18, both tabs as exported
const sheet = parseWorkbook(fixture("summary.csv"), fixture("detail.csv"), YEAR);
const find = (title: string) => sheet.offers.find((o) => o.title.includes(title));

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

describe("tabsFromHtml", () => {
  it("reads the tabs by name from the sheet's public page", () => {
    const html =
      'items.push({name: "العروض السياحية", pageUrl: "https:\\/\\/docs.google.com\\/x?headers\\x3dtrue&gid=690321108", gid: "690321108",initialSheet: ("690321108" == gid)});' +
      'items.push({name: "العروض التفصيلية", pageUrl: "https:\\/\\/docs.google.com\\/x", gid: "1082987500",initialSheet: false});';
    expect(tabsFromHtml(html)).toEqual([
      { name: "العروض السياحية", gid: "690321108" },
      { name: "العروض التفصيلية", gid: "1082987500" },
    ]);
    expect(tabsFromHtml("<html>sign in</html>")).toEqual([]);
  });
});

describe("the new sheet's cells", () => {
  it("reads Arabic separators in a price", () => {
    expect(parsePrice("4٬444٫00")).toBe(4444);
    expect(parsePrice("5,285.40 يورو إجمالي الباقة لشخصين")).toBe(5285.4);
  });

  it("names the currency a price is in", () => {
    expect(currencyOf("ريال سعودي")).toBe("SAR");
    expect(currencyOf("5,285.40 يورو")).toBe("EUR");
    expect(currencyOf("1,463 دولار للفرد")).toBe("USD");
    expect(currencyOf("4٬444٫00", "SAR")).toBe("SAR");
  });

  it("reads who the price is for", () => {
    expect(parseParty("سعر إجمالي لشخصين بالغين")).toEqual({ adults: 2, children: 0 });
    expect(parseParty("سعر بيع لشخصين وطفلين")).toEqual({ adults: 2, children: 2 });
    expect(parseParty("")).toEqual({ adults: null, children: null });
  });

  it("reads each city's nights and the stated total", () => {
    expect(parseCityNights("هانوي 2 + سابا 3 + هانوي 2 = 7 ليالٍ")).toEqual({
      cities: [
        { city_name: "هانوي", nights: 2 },
        { city_name: "سابا", nights: 3 },
        { city_name: "هانوي", nights: 2 },
      ],
      total: 7,
    });
    expect(parseCityNights("إسطنبول 6 ليالٍ").cities).toEqual([{ city_name: "إسطنبول", nights: 6 }]);
    expect(parseCityNights("دبي – 4 ليالٍ").cities).toEqual([{ city_name: "دبي", nights: 4 }]);
    // never guessed
    expect(parseCityNights("تيرانا + بريزرن + تيرانا = 7 ليالٍ (التوزيع التفصيلي غير محدد)")).toEqual({ cities: null, total: 7 });
    expect(parseCityNights("جزيرة ياس – عدد الليالي غير محدد")).toEqual({ cities: null, total: null });
  });

  it("splits the hotels on «؛», one per city as the cities first come", () => {
    const kl = [
      { city_name: "كوالالمبور", nights: 2 },
      { city_name: "جنتنج", nights: 2 },
      { city_name: "كوالالمبور", nights: 3 },
    ];
    expect(matchHotelsToCities("Perdana Kuala Lumpur؛ Wyndham Genting", kl)).toEqual(["Perdana Kuala Lumpur", "Wyndham Genting", "Perdana Kuala Lumpur"]);
  });

  it("splits the inclusions on «؛»", () => {
    expect(parseList("الإقامة والإفطار؛ استقبال وتوديع المطار")).toEqual(["الإقامة والإفطار", "استقبال وتوديع المطار"]);
  });

  it("reads «لا – باص نوم» as no domestic flight", () => {
    expect(hasDomesticFlight("لا – باص نوم ذهابًا وعودة بين هانوي وسابا")).toBe(false);
    expect(hasDomesticFlight("لا")).toBe(false);
    expect(hasDomesticFlight("نعم – هانوي/دانانغ ذهابًا وعودة")).toBe(true);
  });
});

describe("the owner's sheet (2026-10-18)", () => {
  it("imports every summary row, each joined to its details", () => {
    expect(sheet.errors).toEqual([]);
    expect(sheet.offers).toHaveLength(17);
    expect(new Set(sheet.offers.map((o) => o.code)).size).toBe(17);
  });

  it("reads Vietnam end to end", () => {
    const vn = find("هانوي وسابا")!;
    expect(vn).toMatchObject({ country: "فيتنام", days: 8, nights: 7, price: 4444, currency: "SAR", status: "ready", published: true, adults: 2, children: 0, problems: [] });
    expect(vn.cities?.map((c) => c.city_name)).toEqual(["هانوي", "سابا", "هانوي"]);
    expect(vn.hotels_by_city).toEqual(["Oriental Suites Hanoi", "Bamboo Sapa", "Church Boutique 58 Hang Gai"]);
    expect(vn.design_url).toContain("drive.google.com");
    expect(vn.includes).toContain("الإقامة والإفطار");
  });

  it("imports «لم يتم النشر» unpublished", () => {
    expect(sheet.offers.filter((o) => !o.published).map((o) => o.title)).toEqual(
      expect.arrayContaining([expect.stringContaining("الشمال التركي"), expect.stringContaining("العلمين"), expect.stringContaining("جزيرة ياس")]),
    );
  });

  it("joins the rows without a number by their country", () => {
    expect(find("المغرب")?.tours_text).toContain("مراكش");
    expect(find("أوروبا")?.tours_text).toContain("روما");
    expect(find("البانيا")?.design_url).toContain("drive.google.com");
  });

  it("marks exactly the five offers the sheet contradicts itself on — with the reasons", () => {
    const flagged = sheet.offers.filter((o) => o.problems.length);
    expect(flagged.map((o) => o.country.trim())).toEqual(["تايلند", "الإمارات العربية المتحدة", "البانيا", "المغرب", "أوروبا"]);
    expect(find("فوكيت")!.problems[0]).toContain("فوكوك");
    expect(find("أوروبا")!.problems.join(" ")).toContain("5,285.40 يورو");
    expect(find("المغرب")!.problems.join(" ")).toContain("دولار للفرد");
    expect(find("جزيرة ياس")!.problems.join(" ")).toContain("غير محدد");
    expect(find("البانيا")!.problems.join(" ")).toContain("تيرانا + بريزرن");
  });

  it("never seeds cities the two tabs disagree on", () => {
    for (const o of sheet.offers) {
      if (!o.cities) continue;
      expect(o.cities.reduce((s, c) => s + c.nights, 0)).toBe(o.nights);
      expect(o.hotels_by_city).toHaveLength(o.cities.length);
    }
    expect(find("البانيا")!.cities).toBeNull();
  });
});

describe("buildSeed", () => {
  const vn = find("هانوي وسابا")!;
  const seed = buildSeed(vn, "ro-1");

  it("locks the company price via pricing.final_total", () => {
    expect(seed.pricing?.final_total).toBe(4444);
    expect(seed.pricing?.items).toEqual([]);
    expect(seed.pricing?.display_currency).toBe("SAR");
  });

  it("seeds cities and name-only hotel shells with no supplier sourcing", () => {
    expect(seed.cities?.map((c) => c.nights)).toEqual([2, 3, 2]);
    expect(seed.hotels![1].hotel_name).toBe("Bamboo Sapa");
    expect(seed.hotels![0]).not.toHaveProperty("sourcing");
  });

  it("seeds the party the price is for", () => {
    expect(seed.trip).toMatchObject({ adults: 2, children: 0 });
    const yas = buildSeed(find("جزيرة ياس")!, "ro-2");
    expect(yas.trip).toMatchObject({ adults: 2, children: 2, children_ages: [6, 6] });
  });

  it("leaves the salesperson's fields empty", () => {
    expect(seed.customer).toBeUndefined();
    expect(seed.trip?.arrival_date).toBeNull();
    expect(seed.days).toBeUndefined();
  });

  it("carries management's standing terms, the domestic-flight clause only with a flight", () => {
    const clause = "الطيران الداخلي غير قابل للاسترجاع";
    expect(seed.services?.terms.join(" ")).toContain("تابي وتمارا");
    expect(seed.services?.terms.join(" ")).not.toContain(clause);
    expect(buildSeed(find("دانانغ")!, "ro-3").services?.terms.join(" ")).toContain(clause);
  });

  it("records the source", () => {
    expect(seed.source).toMatchObject({ ready_offer_id: "ro-1", code: vn.code, tier: "" });
  });
});

describe("canStartFrom", () => {
  const row = { active: true, status: "ready" as const, published: true, problems: [] };
  it("only a live, priced, published offer the sheet agrees on starts a file", () => {
    expect(canStartFrom(row)).toBe(true);
    expect(canStartFrom({ ...row, problems: ["السعر …"] })).toBe(false);
    expect(canStartFrom({ ...row, published: false })).toBe(false);
    expect(canStartFrom({ ...row, status: "coming_soon" })).toBe(false);
    expect(canStartFrom({ ...row, active: false })).toBe(false);
    // a row from before 0097 carries neither column
    expect(canStartFrom({ active: true, status: "ready", published: null, problems: null })).toBe(true);
  });
});
