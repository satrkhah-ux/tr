import { describe, expect, it } from "vitest";
import { parseSupplierPackage } from "./parse";

/** A realistic text-based supplier program (labels + sections, Arabic). */
const SAMPLE = `
عرض سياحي — شركة النخبة للسياحة
الوجهة: ماليزيا
البلد: ماليزيا
عدد الليالي: 7 ليالي
الوصول: 10/03/2026
المغادرة: 17/03/2026
المسافرون: 2 بالغين و 1 طفل

المدينة: كوالالمبور - 4 ليالي
المدينة: لنكاوي - 3 ليالي

الفندق: فندق جراند ميلينيوم | غرفة ديلوكس | BB | 4 ليالي
الفندق: منتجع بيلانجي | شاليه | HB | 3 ليالي

يشمل
- الإقامة الفندقية
- الإفطار اليومي
- الاستقبال من المطار

لا يشمل
- تذاكر الطيران الدولية
- التأشيرة

الشروط والأحكام
- الأسعار قابلة للتغيير حسب التوفر
- يلزم عربون 30%

الإجمالي: 7,500 ريال سعودي
`;

describe("parseSupplierPackage — clean text PDF", () => {
  const { extracted, confidence } = parseSupplierPackage(SAMPLE);

  it("reads destination + country", () => {
    expect(extracted.country).toBe("ماليزيا");
    expect(extracted.destination).toBe("ماليزيا");
    expect(confidence.country).toBeGreaterThanOrEqual(0.7);
  });

  it("reads cities with nights", () => {
    expect(extracted.cities).toEqual([
      { city_name: "كوالالمبور", nights: 4 },
      { city_name: "لنكاوي", nights: 3 },
    ]);
  });

  it("reads trip nights that reconcile with the cities", () => {
    expect(extracted.trip_nights).toBe(7);
    expect(confidence.trip_nights).toBeGreaterThanOrEqual(0.7);
  });

  it("reads dates (DD/MM)", () => {
    expect(extracted.arrival_date).toBe("2026-03-10");
    expect(extracted.departure_date).toBe("2026-03-17");
  });

  it("reads pax", () => {
    expect(extracted.adults).toBe(2);
    expect(extracted.children).toBe(1);
  });

  it("reads hotels with board", () => {
    expect(extracted.hotels).toHaveLength(2);
    expect(extracted.hotels[0].hotel_name).toBe("فندق جراند ميلينيوم");
    expect(extracted.hotels[0].board).toBe("BB");
    expect(extracted.hotels[1].board).toBe("HB");
  });

  it("reads includes / excludes / terms sections", () => {
    expect(extracted.includes).toContain("الإقامة الفندقية");
    expect(extracted.excludes).toContain("التأشيرة");
    expect(extracted.terms.length).toBeGreaterThanOrEqual(2);
  });

  it("reads the supplier price with its currency", () => {
    expect(extracted.supplier_total).toBe(7500);
    expect(extracted.supplier_currency).toBe("SAR");
    expect(confidence.supplier_total).toBeGreaterThanOrEqual(0.7);
  });
});

describe("parseSupplierPackage — never invents", () => {
  const { extracted, confidence } = parseSupplierPackage("نص لا يحتوي أي حقول معروفة");

  it("leaves fields empty with zero confidence on criticals", () => {
    expect(extracted.country).toBe("");
    expect(extracted.cities).toEqual([]);
    expect(extracted.supplier_total).toBeNull();
    expect(confidence.country).toBe(0);
    expect(confidence.cities).toBe(0);
    expect(confidence.supplier_total).toBe(0);
  });
});
