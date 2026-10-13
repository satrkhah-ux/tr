import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { catalogSkel, closestName, looksLikeHotel, normAr, normEn, similarity } from "./norm";

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

  it("reduces a name to the skeleton the fuzzy search matches", () => {
    expect(catalogSkel("ملينيوم")).toBe(catalogSkel("ميلينيوم"));
    expect(catalogSkel("فندق ميلينيوم")).toContain(catalogSkel("ملينيوم"));
    expect(catalogSkel("Millennium Hotel")).toContain(catalogSkel("Milenium"));
    expect(catalogSkel("كوالالامبور")).toBe(catalogSkel("كوالالمبور"));
    expect(catalogSkel("فندق  (الماسة)")).toBe("فندقلمسه");
    expect(catalogSkel("")).toBe("");
  });

  it("keeps catalogSkel's letters in step with catalog_skel in 0070", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../../supabase/migrations/0070_data_tools.sql", import.meta.url)),
      "utf8",
    );
    const source = readFileSync(fileURLToPath(new URL("./norm.ts", import.meta.url)), "utf8");
    expect(sql).toContain("'اويءئؤaeiouy'");
    expect(source).toContain("/[اويءئؤaeiouy]/g");
    expect(sql).toContain(`'[ _.,''"()&/*+:;!?#@،-]'`);
    expect(source).toContain(`/[ _.,'"()&/*+:;!?#@،-]/g`);
    expect(sql).toContain("'(.)\\1+', '\\1'");
  });

  it("flags hotel-shaped names, not real places", () => {
    expect(looksLikeHotel("شقق أونا الفندقية")).toBe(true);
    expect(looksLikeHotel("The Colony & Luxe Klcc by Five Senses")).toBe(true);
    expect(looksLikeHotel("قدح")).toBe(false);
    expect(looksLikeHotel("كوالالمبور")).toBe(false);
  });
});
