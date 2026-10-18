import { describe, expect, it } from "vitest";
import { assignedAtFrom, classifyInquiry, delayText, findPlace, replyAfter } from "./auto";

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

describe("the hand-over times (0098)", () => {
  const events = [
    { at: 100, kind: "client", text: "السلام عليكم", sender: "عميل", isPrivate: false },
    { at: 160, kind: "agent", text: "أهلاً", sender: "احمد", isPrivate: false },
    { at: 300, kind: "activity", text: "Assigned to سارة by احمد", sender: null, isPrivate: false },
    { at: 320, kind: "agent", text: "ملاحظة", sender: "سارة", isPrivate: true },
    { at: 350, kind: "agent", text: "أبشر", sender: "احمد", isPrivate: false },
    { at: 420, kind: "agent", text: "مرحباً، معك سارة", sender: "سارة", isPrivate: false },
  ];

  it("takes the hand-over's time from the activity line naming the new agent", () => {
    expect(assignedAtFrom(events, "سارة", 600)).toBe(300);
    expect(assignedAtFrom(events, "خالد", 600)).toBeNull();
    expect(assignedAtFrom(events, null, 600)).toBeNull();
  });

  it("the new agent's first reply after it — never a private note, never someone else's", () => {
    expect(replyAfter(events, 300, "سارة")).toBe(420);
    // the agent's Teletel name unknown (handed over on the page): anyone of ours
    expect(replyAfter(events, 300, null)).toBe(350);
    expect(replyAfter(events, 500, "سارة")).toBeNull();
  });
});
