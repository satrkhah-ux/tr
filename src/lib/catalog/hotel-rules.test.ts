import { describe, expect, it } from "vitest";
import { hasArabicLetter, hotelRuleError, similarHotels, type HotelLite } from "./hotel-rules";

describe("hotel rules", () => {
  it("wants Arabic letters in the Arabic name", () => {
    expect(hasArabicLetter("فندق بولمان")).toBe(true);
    expect(hasArabicLetter("Pullman KLCC")).toBe(false);
    expect(hotelRuleError({ arabic_name: "Pullman KLCC", city_id: "c1" }, true)).toBe("data.tools.err.arabicLetters");
    expect(hotelRuleError({ arabic_name: "  ", city_id: "c1" }, true)).toBe("data.tools.err.arabicRequired");
  });

  it("requires the city on create and stars 1–5", () => {
    expect(hotelRuleError({ arabic_name: "بولمان" }, true)).toBe("data.tools.err.cityRequired");
    expect(hotelRuleError({ arabic_name: "بولمان", city_id: "c1", stars: 6 }, true)).toBe("data.tools.err.stars");
    expect(hotelRuleError({ arabic_name: "بولمان", city_id: "c1", stars: 4.5 }, true)).toBe("data.tools.err.stars");
    expect(hotelRuleError({ arabic_name: "بولمان", city_id: "c1", stars: 5 }, true)).toBeNull();
    expect(hotelRuleError({ arabic_name: "بولمان", city_id: "c1", stars: null }, true)).toBeNull();
  });

  it("checks an update only on the fields it carries", () => {
    // an import that changes the phone of a legacy Latin-named row is not refused
    expect(hotelRuleError({ contact_number: "+60 3 1234" }, false)).toBeNull();
    expect(hotelRuleError({ arabic_name: "Pullman" }, false)).toBe("data.tools.err.arabicLetters");
    expect(hotelRuleError({ city_id: null }, false)).toBe("data.tools.err.cityRequired");
  });
});

describe("similarHotels", () => {
  const rows: HotelLite[] = [
    { id: "1", arabic_name: "بولمان كوالالمبور سيتي سنتر", english_name: "Pullman Kuala Lumpur City Centre Hotel & Residences", city_id: "kl" },
    { id: "2", arabic_name: "فندق ميلينيوم", english_name: "Millennium Hotel", city_id: "kl" },
    { id: "3", arabic_name: "فندق ميلينيوم", english_name: null, city_id: "dubai" },
    { id: "4", arabic_name: "Grand Hyatt", english_name: null, city_id: "kl" },
    { id: "5", arabic_name: "شيراتون", english_name: "Sheraton", city_id: "kl" },
  ];

  it("finds the existing Pullman by its English name", () => {
    const hits = similarHotels({ arabic: "", english: "Pullman Kuala Lumpur City Centre Hotel & Residences", cityId: "kl" }, rows);
    expect(hits.map((h) => h.id)).toEqual(["1"]);
    expect(hits[0]).toMatchObject({ exact: true, sameCity: true });
  });

  it("puts the same city first and folds ة/ه and alef forms", () => {
    const hits = similarHotels({ arabic: "فندق ميلينيوم", english: "", cityId: "kl" }, rows);
    expect(hits.map((h) => h.id)).toEqual(["2", "3"]);
    expect(hits[1].sameCity).toBe(false);
  });

  it("catches a near spelling and a Latin name typed in the Arabic field", () => {
    expect(similarHotels({ arabic: "فندق ميلنيوم", english: "", cityId: null }, rows).map((h) => h.id)).toContain("2");
    expect(similarHotels({ arabic: "", english: "Grand Hyatt", cityId: "kl" }, rows)[0]).toMatchObject({ id: "4", exact: true });
  });

  it("leaves the row being edited out, and stays quiet for short or unrelated names", () => {
    expect(similarHotels({ arabic: "شيراتون", english: "", cityId: "kl", excludeId: "5" }, rows)).toEqual([]);
    expect(similarHotels({ arabic: "فن", english: "", cityId: "kl" }, rows)).toEqual([]);
    expect(similarHotels({ arabic: "هيلتون", english: "", cityId: "kl" }, rows)).toEqual([]);
  });
});
