import { describe, expect, it } from "vitest";
import { campaignDestination, resolvePlace } from "./places";

const places = [
  { name: "تركيا", country: "تركيا" },
  { name: "اسطنبول", country: "تركيا" },
  { name: "طرابزون", country: "تركيا" },
  { name: "اندونيسيا", country: "اندونيسيا" },
  { name: "جاكرتا", country: "اندونيسيا" },
  { name: "ماليزيا", country: "ماليزيا" },
  { name: "كوالالمبور", country: "ماليزيا" },
  { name: "السعودية", country: "السعودية" },
  { name: "المدينة المنورة", country: "السعودية" },
  { name: "جدة", country: "السعودية" },
  { name: "مصر", country: "مصر" },
  { name: "القاهرة", country: "مصر" },
];

describe("what is a destination (the owner, 2026-10-19)", () => {
  it("a city counts for its country, and as itself", () => {
    expect(resolvePlace("اسطنبول", places)).toEqual({ kind: "destination", country: "تركيا", city: "اسطنبول" });
    expect(resolvePlace("تركيا", places)).toEqual({ kind: "destination", country: "تركيا", city: null });
    expect(resolvePlace("جاكرتا", places)).toEqual({ kind: "destination", country: "اندونيسيا", city: "جاكرتا" });
  });
  it("the spellings the catalogue lacks", () => {
    expect(resolvePlace("يلوا", places)).toEqual({ kind: "destination", country: "تركيا", city: "يلوا" });
    expect(resolvePlace("بالي", places)).toEqual({ kind: "destination", country: "اندونيسيا", city: "بالي" });
    expect(resolvePlace("بونشاك", places)).toEqual({ kind: "destination", country: "اندونيسيا", city: "بونشاك" });
    expect(resolvePlace("شنغن", places)).toEqual({ kind: "destination", country: "شنغن (أوروبا)", city: null });
    expect(resolvePlace("الشمال التركي", places)).toEqual({ kind: "destination", country: "تركيا", city: "الشمال التركي" });
    expect(resolvePlace("بريطانيا", places)).toEqual({ kind: "destination", country: "المملكة المتحدة", city: null });
  });
  it("a Saudi place is where the client is, never a destination", () => {
    expect(resolvePlace("المدينة المنورة", places)).toEqual({ kind: "origin", place: "المدينة المنورة" });
    expect(resolvePlace("جده", places)).toEqual({ kind: "origin", place: "جدة" });
    expect(resolvePlace("السعوديه", places)).toEqual({ kind: "origin", place: "السعودية" });
    expect(resolvePlace("داخلي", places)).toEqual({ kind: "origin", place: "داخلي" });
    expect(resolvePlace("مكة", places)).toEqual({ kind: "origin", place: "مكة" });
    expect(resolvePlace("المدينة", places)).toEqual({ kind: "origin", place: "المدينة" });
  });
  it("in a sentence, the destination wins over where the client is; «المملكة المتحدة» is no Saudi place", () => {
    const withUk = [...places, { name: "المملكة المتحدة", country: "المملكة المتحدة" }];
    expect(resolvePlace("انا من السعودية وابي تأشيرة الى لندن", withUk)).toEqual({ kind: "destination", country: "المملكة المتحدة", city: "لندن" });
    expect(resolvePlace("المملكة المتحدة", withUk)).toEqual({ kind: "destination", country: "المملكة المتحدة", city: null });
    expect(resolvePlace("المملكة", withUk)).toEqual({ kind: "origin", place: "المملكة" });
  });

  it("nothing said, or nothing known", () => {
    expect(resolvePlace("لم يحدد طلب", places)).toEqual({ kind: "none" });
    expect(resolvePlace("", places)).toEqual({ kind: "none" });
    expect(resolvePlace("زنجبار", places)).toEqual({ kind: "none" });
  });
});

describe("a Google campaign's destination, by the same rule", () => {
  it("from its name; a Saudi-city campaign is general; the visa ones apart", () => {
    expect(campaignDestination("003  بحث ماليزيا 🟩 كامل", places)).toBe("ماليزيا");
    expect(campaignDestination("004 بحث اسطنبول تركيا 🟥 كامل", places)).toBe("تركيا");
    expect(campaignDestination("1 بحث عام صوري اتصال ✅ المدينة", places)).toBe("عام");
    expect(campaignDestination("بحث VISA", places)).toBe("تأشيرات");
    expect(campaignDestination("بحث البوسنة 🍃🌳🍃", places)).toBe("البوسنة والهرسك");
    expect(campaignDestination("بحث أوروبا", places)).toBe("شنغن (أوروبا)");
    expect(campaignDestination("VISA بريطانيا", places)).toBe("المملكة المتحدة");
  });
});
