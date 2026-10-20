import { describe, expect, it } from "vitest";
import { classifyInquiry, delayText, findPlace, parseAssignment, timelineFrom } from "./auto";

const PLACES = [
  { name: "تركيا", country: "تركيا" },
  { name: "الشمال التركي", country: "تركيا" },
  { name: "طرابزون", country: "تركيا" },
  { name: "ماليزيا", country: "ماليزيا" },
  { name: "كوالالمبور", country: "ماليزيا" },
];

describe("«العملاء» automatic classification", () => {
  it("does not invent Yalova from staff wording or Bali from part of a word", () => {
    const places = [...PLACES, { name: "يلوا", country: "تركيا" }, { name: "بالي", country: "اندونيسيا" }, { name: "اندونيسيا", country: "اندونيسيا" }];
    expect(findPlace([], "بالتفاصيل والبرنامج والاسعار", places)).toBe("");
    expect(findPlace([], "ممكن تعطيني تفاصيل أكثر عن العروض الحالية", places)).toBe("");
    expect(findPlace([], "اندونيسيا", places)).toBe("اندونيسيا");
    expect(findPlace([], "أبي رحلة لتركيا", places)).toBe("تركيا");
    expect(findPlace([], "باليوم كم؟", places)).toBe("");
  });
  it("reads the kind from the labels first, then the client's words", () => {
    expect(classifyInquiry(["بكج"], "كم سعر التذكرة")).toBe("بكج");
    expect(classifyInquiry([], "ابغى باقة شهر عسل")).toBe("بكج");
    expect(classifyInquiry([], "كم سعر تأشيرة بريطانيا")).toBe("تأشيرات");
    expect(classifyInquiry([], "ابي حجز فندق في مكة")).toBe("فنادق");
    expect(classifyInquiry([], "عندكم تذاكر للرياض؟")).toBe("طيران");
    expect(classifyInquiry([], "ابي سيارة مع سائق")).toBe("مواصلات");
    expect(classifyInquiry([], "السلام عليكم")).toBe("طلب غير واضح");
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

describe("the conversation's turns (0099)", () => {
  it("reads the account's activity lines", () => {
    expect(parseAssignment("تم إسنادها إلى احمد القدسي بواسطة محمد اسكندر")).toEqual({ agent: "احمد القدسي", by: "محمد اسكندر" });
    expect(parseAssignment("تم تعيينه إلى محمد صالح عبر قسم المبيعات  بواسطة محمد اسكندر")).toEqual({ agent: "محمد صالح", by: "محمد اسكندر" });
    expect(parseAssignment("رشا تم تعيينه تلقائياً لهذه المحادثة")).toEqual({ agent: "رشا", by: null });
    expect(parseAssignment("إلغاء التعيين من قسم المبيعات  بواسطة محمد اسكندر")).toBeNull();
  });

  const isTeam = (n: string) => n.startsWith("قسم");
  // conversation 40182 as Teletel holds it: رشا auto-assigned, the queue, محمد اسكندر, then اكرم الحريبي
  const events = [
    { at: 100, kind: "client", text: "السلام عليكم", sender: "عميل", isPrivate: false },
    { at: 101, kind: "activity", text: "رشا تم تعيينه تلقائياً لهذه المحادثة", sender: null, isPrivate: false },
    { at: 102, kind: "activity", text: "تم إسنادها إلى قسم الطلبات بواسطة رشا", sender: null, isPrivate: false },
    { at: 160, kind: "agent", text: "أهلاً", sender: "رشا", isPrivate: false },
    { at: 600, kind: "activity", text: "تم إسنادها إلى محمد اسكندر بواسطة رشا", sender: null, isPrivate: false },
    { at: 650, kind: "agent", text: "ملاحظة", sender: "محمد اسكندر", isPrivate: true },
    { at: 700, kind: "agent", text: "تفضل", sender: "رشا", isPrivate: false },
    { at: 900, kind: "agent", text: "معك محمد", sender: "محمد اسكندر", isPrivate: false },
    { at: 2000, kind: "activity", text: "تم إسنادها إلى اكرم الحريبي بواسطة محمد اسكندر", sender: null, isPrivate: false },
  ];

  it("one turn an agent: received, answered, handed on — a queue, a note or a colleague's reply is no turn", () => {
    expect(timelineFrom(events, 100, isTeam)).toEqual([
      { agent: "رشا", from: 101, reply: 160, handed: 600, by: null },
      { agent: "محمد اسكندر", from: 600, reply: 900, handed: 2000, by: "رشا" },
      { agent: "اكرم الحريبي", from: 2000, reply: null, handed: null, by: "محمد اسكندر" },
    ]);
  });

  it("no hand-over: the first of ours to answer is the first receiver, from the client's first message", () => {
    expect(timelineFrom(events.filter((e) => e.kind !== "activity"), 100, isTeam)).toEqual([{ agent: "رشا", from: 100, reply: 160, handed: null, by: null }]);
  });
});

describe("a service the client does not want is not their request", () => {
  it("«رحلة جورجيا 10 أيام بدون طيران» is no flight", () => {
    expect(classifyInquiry([], "ابي رحلة جورجيا 10 أيام بدون طيران")).toBe("طلب غير واضح");
    expect(classifyInquiry([], "بكج تركيا بدون طيران")).toBe("بكج");
    expect(classifyInquiry([], "ابي تذاكر طيران")).toBe("طيران");
  });
});
it("does not treat greetings as a confirmed inquiry, and ignores a retired generic label", () => {
  expect(classifyInquiry([], "السلام عليكم ممكن تفاصيل")).toBe("طلب غير واضح");
  expect(classifyInquiry(["يستفسر"], "السلام عليكم")).toBe("طلب غير واضح");
  expect(classifyInquiry([], "أريد تأشيرة")).toBe("تأشيرات");
});

it("uses the requested service even when a retired label is present", () => {
  expect(classifyInquiry(["يستفسر"], "أريد حجز فندق")).toBe("فنادق");
  expect(classifyInquiry(["استفسار"], "تأشيرة مصر")).toBe("تأشيرات");
});
