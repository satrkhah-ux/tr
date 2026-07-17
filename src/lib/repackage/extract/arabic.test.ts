import { describe, expect, it } from "vitest";
import { detectCurrency, normalizeDigits, parseDate, parseMoney, parseNights, parseNumber } from "./arabic";

describe("normalizeDigits", () => {
  it("converts Arabic-Indic digits", () => {
    expect(normalizeDigits("٣ ليالي بسعر ١٢٣٤٥")).toBe("3 ليالي بسعر 12345");
  });
  it("converts Eastern-Arabic digits", () => {
    expect(normalizeDigits("۲۰۲۶")).toBe("2026");
  });
  it("converts Arabic separators", () => {
    expect(normalizeDigits("١٢٬٥٠٠٫٧٥")).toBe("12,500.75");
  });
  it("repairs pdf lam-alef ToUnicode swaps (اإل → الإ)", () => {
    expect(normalizeDigits("اإلجمالي")).toBe("الإجمالي");
    expect(normalizeDigits("األسعار واألحكام")).toBe("الأسعار والأحكام");
    expect(normalizeDigits("االستقبال")).toBe("الاستقبال");
  });
  it("leaves legitimate إل words alone (إلى)", () => {
    expect(normalizeDigits("إلى المدينة")).toBe("إلى المدينة");
  });
  it("repairs the standalone لا swap (ال يشمل → لا يشمل)", () => {
    expect(normalizeDigits("ال يشمل")).toBe("لا يشمل");
  });
  it("never touches attached definite articles", () => {
    expect(normalizeDigits("البلد المدينة الفندق")).toBe("البلد المدينة الفندق");
  });
});

describe("pdf reversed-numeric repairs", () => {
  it("repairs a reversed thousands-grouped price (005,7 → 7,500)", () => {
    expect(parseNumber("اإلجمالي: 005,7 ريال")).toBe(7500);
  });
  it("keeps a valid grouped number untouched", () => {
    expect(parseNumber("7,500 ريال")).toBe(7500);
  });
  it("keeps decimals untouched", () => {
    expect(parseNumber("0.5")).toBe(0.5);
  });
  it("repairs a reversed date (6202/30/01 → 2026-03-10)", () => {
    const d = parseDate("6202/30/01");
    expect(d?.iso).toBe("2026-03-10");
    expect(d!.confidence).toBeLessThanOrEqual(0.75);
  });
});

describe("parseNumber", () => {
  it("reads thousands separators", () => {
    expect(parseNumber("الإجمالي: 12,500.50 ريال")).toBe(12500.5);
  });
  it("reads Arabic-Indic numbers", () => {
    expect(parseNumber("السعر ٤٥٠٠")).toBe(4500);
  });
  it("returns null when no number", () => {
    expect(parseNumber("لا يوجد")).toBeNull();
  });
});

describe("parseDate", () => {
  it("parses ISO dates with high confidence", () => {
    expect(parseDate("2026-03-15")).toEqual({ iso: "2026-03-15", confidence: 0.95 });
  });
  it("parses Arabic month names", () => {
    expect(parseDate("15 مارس 2026")?.iso).toBe("2026-03-15");
  });
  it("assumes DD/MM and flags ambiguity with lower confidence", () => {
    const d = parseDate("10/03/2026");
    expect(d?.iso).toBe("2026-03-10");
    expect(d!.confidence).toBeLessThan(0.7);
  });
  it("is certain when the day cannot be a month", () => {
    const d = parseDate("25/03/2026");
    expect(d?.iso).toBe("2026-03-25");
    expect(d!.confidence).toBeGreaterThan(0.7);
  });
  it("swaps an MM/DD form when unambiguous", () => {
    expect(parseDate("03/25/2026")?.iso).toBe("2026-03-25");
  });
  it("parses Arabic-Indic numeric dates", () => {
    expect(parseDate("٢٥/٠٣/٢٠٢٦")?.iso).toBe("2026-03-25");
  });
});

describe("parseNights", () => {
  it("reads Arabic nights", () => {
    expect(parseNights("٣ ليالٍ")).toBe(3);
    expect(parseNights("4 ليالي في اسطنبول")).toBe(4);
  });
  it("reads English nights", () => {
    expect(parseNights("3 nights")).toBe(3);
  });
  it("returns null without a nights token", () => {
    expect(parseNights("3 أيام")).toBeNull();
  });
});

describe("money + currency", () => {
  it("detects SAR from ريال", () => {
    expect(detectCurrency("4500 ريال سعودي")).toBe("SAR");
  });
  it("detects USD from $", () => {
    expect(detectCurrency("$1,200")).toBe("USD");
  });
  it("parseMoney: explicit currency → high confidence", () => {
    expect(parseMoney("الإجمالي 8,500 ريال")).toEqual({ amount: 8500, currency: "SAR", confidence: 0.9 });
  });
  it("parseMoney: inferred default → medium confidence", () => {
    const m = parseMoney("الإجمالي 8,500");
    expect(m).toEqual({ amount: 8500, currency: "SAR", confidence: 0.6 });
  });
});
