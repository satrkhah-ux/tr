import { describe, expect, it } from "vitest";
import { closestName, looksLikeHotel, normAr, normEn, similarity } from "./norm";

describe("catalog name folding", () => {
  it("folds alef forms, ta marbuta, alef maqsura, diacritics and spaces", () => {
    expect(normAr("  إسطنبول ")).toBe("اسطنبول");
    expect(normAr("عُمان")).toBe("عمان");
    expect(normAr("غرفة  عائليّة")).toBe("غرفه عائليه");
    expect(normAr("مستشفى")).toBe("مستشفي");
  });

  it("keeps English only when it holds a Latin letter", () => {
    expect(normEn("Hard Rock Hotel Bali.")).toBe("hard rock hotel bali");
    expect(normEn("4 غرف وصالتين")).toBe("");
  });

  it("scores one-letter typos as near and different places as far", () => {
    expect(similarity(normAr("كوالالامبور"), normAr("كوالالمبور"))).toBeGreaterThan(0.85);
    expect(similarity(normAr("شيانغ ماي"), normAr("شيانغ راي"))).toBeLessThan(0.9);
  });

  it("asks «هل تقصد» for a near name and answers exactly for a folded one", () => {
    const cities = ["كوالالمبور", "سيلانجور", "لنكاوي"];
    expect(closestName("كوالالامبور", cities, (c) => c)).toEqual({ row: "كوالالمبور", exact: false });
    expect(closestName("لنكاوى", cities, (c) => c)).toEqual({ row: "لنكاوي", exact: true });
    expect(closestName("بينانج", cities, (c) => c)).toBeNull();
  });

  it("flags hotel-shaped names, not real places", () => {
    expect(looksLikeHotel("شقق أونا الفندقية")).toBe(true);
    expect(looksLikeHotel("The Colony & Luxe Klcc by Five Senses")).toBe(true);
    expect(looksLikeHotel("قدح")).toBe(false);
    expect(looksLikeHotel("كوالالمبور")).toBe(false);
  });
});
