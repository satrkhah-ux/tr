import { describe, expect, it } from "vitest";
import { catalogFor, saleMarker, saleVisaLines } from "./from-sale-core";

describe("a sale's visa lines", () => {
  it("reads the issued draft's visas, one line per country and type", () => {
    const lines = saleVisaLines({ scope: { visas: true }, visas: [
      { country: " الصين ", visa_type: "سياحية", count: 2, note: "" },
      { country: "الصين", visa_type: "سياحية", count: 1, note: "عاجل" },
      { country: "تركيا", visa_type: "", count: 3, note: "" },
    ] });
    expect(lines).toEqual([
      { country: "الصين", visaType: "سياحية", applicants: 3, note: "عاجل" },
      { country: "تركيا", visaType: null, applicants: 3, note: null },
    ]);
  });

  it("opens nothing without a draft, with the visas switch off, or with lines that name no country", () => {
    expect(saleVisaLines(null)).toEqual([]);
    expect(saleVisaLines({ scope: { visas: false }, visas: [{ country: "الصين", count: 1 }] })).toEqual([]);
    expect(saleVisaLines({ visas: [{ country: "", count: 2 }, null, "x"] })).toEqual([]);
    expect(saleVisaLines({})).toEqual([]);
  });

  it("keeps the head count between 1 and 50", () => {
    expect(saleVisaLines({ visas: [{ country: "الصين", count: 0 }] })[0].applicants).toBe(1);
    expect(saleVisaLines({ visas: [{ country: "الصين", count: "x" }] })[0].applicants).toBe(1);
    expect(saleVisaLines({ visas: [{ country: "الصين", count: 400 }] })[0].applicants).toBe(50);
  });

  it("names a sale's files by its serial", () => {
    expect(saleMarker("AD-5-3269")).toBe("من البيع AD-5-3269");
  });
});

describe("the catalogue row of a sale line", () => {
  const rows = [
    { id: "a", country: "الصين", visa_type: "سياحية" },
    { id: "b", country: "الصين", visa_type: "تجارية" },
    { id: "c", country: "تركيا", visa_type: "إلكترونية" },
  ];
  it("takes the same type, or the country's only row, and never guesses between several", () => {
    expect(catalogFor({ country: "الصين", visaType: "تجارية", applicants: 1, note: null }, rows)?.id).toBe("b");
    expect(catalogFor({ country: "تركيا", visaType: null, applicants: 1, note: null }, rows)?.id).toBe("c");
    expect(catalogFor({ country: "الصين", visaType: null, applicants: 1, note: null }, rows)).toBeNull();
    expect(catalogFor({ country: "اليابان", visaType: null, applicants: 1, note: null }, rows)).toBeNull();
  });
});
