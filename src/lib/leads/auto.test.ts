import { describe, expect, it } from "vitest";
import { classifyInquiry, delayText, findPlace } from "./auto";

const PLACES = [
  { name: "تركيا", country: "تركيا" },
  { name: "الشمال التركي", country: "تركيا" },
  { name: "طرابزون", country: "تركيا" },
  { name: "ماليزيا", country: "ماليزيا" },
  { name: "كوالالمبور", country: "ماليزيا" },
];

describe("«العملاء» automatic classification", () => {
  it("reads the kind from the labels first, then the client's words", () => {
    expect(classifyInquiry(["بكج"], "كم سعر التذكرة")).toBe("بكج");
    expect(classifyInquiry([], "ابغى باقة شهر عسل")).toBe("بكج");
    expect(classifyInquiry([], "كم سعر تأشيرة بريطانيا")).toBe("تأشيرات");
    expect(classifyInquiry([], "ابي حجز فندق في مكة")).toBe("فنادق");
    expect(classifyInquiry([], "عندكم تذاكر للرياض؟")).toBe("طيران");
    expect(classifyInquiry([], "ابي سيارة مع سائق")).toBe("مواصلات");
    expect(classifyInquiry([], "السلام عليكم")).toBe("يستفسر");
    expect(classifyInquiry([], "")).toBe("");
  });

  it("names the most precise place: a region or city before its country", () => {
    expect(findPlace([], "ابي برنامج الشمال التركي ١٠ ايام", PLACES)).toBe("الشمال التركي");
    expect(findPlace(["رحلة ماليزيا"], "طرابزون", PLACES)).toBe("ماليزيا");
    expect(findPlace([], "رحلة الى كوالالمبور", PLACES)).toBe("كوالالمبور");
    expect(findPlace([], "السلام عليكم", PLACES)).toBe("");
  });

  it("says the delay from the clock", () => {
    expect(delayText({ waitingSince: 1000, firstReplyAt: null, createdAt: 900 }, 1000 + 25 * 60)).toBe("ينتظر ردنا منذ 25 دقيقة");
    expect(delayText({ waitingSince: 0, firstReplyAt: 900 + 3 * 3600, createdAt: 900 }, 99999)).toBe("أول رد بعد 3 ساعة");
    expect(delayText({ waitingSince: 0, firstReplyAt: null, createdAt: 900 }, 99999)).toBe("");
  });
});
