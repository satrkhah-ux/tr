import { describe, expect, it } from "vitest";
import {
  clarifyText,
  parseDelay,
  pickDelay,
  decideReception,
  firstName,
  isWorkingTime,
  parseHours,
  readRequest,
  readRoutes,
  receptionText,
  suggestRoutes,
  teamFor,
} from "./reception";

const places = [
  { name: "بريطانيا", country: "بريطانيا" },
  { name: "لندن", country: "بريطانيا" },
  { name: "تركيا", country: "تركيا" },
];

describe("what the client asked (the owner's examples, 2026-10-18)", () => {
  it("«السلام عليكم ابغى تأشيرة الى لندن» → visas, Britain, with salam", () => {
    expect(readRequest("السلام عليكم ابغى تأشيرة الى لندن", places)).toEqual({ kind: "تأشيرات", country: "بريطانيا", wantsHuman: false, salam: true });
  });
  it("«بكج تركيا» → packages, Turkey", () => {
    expect(readRequest("بكج تركيا", places)).toMatchObject({ kind: "بكج", country: "تركيا" });
  });
  it("«ابي اكلم موظف» → a person", () => {
    expect(readRequest("ابي اكلم موظف", places).wantsHuman).toBe(true);
  });
  it("«السلام عليكم» alone names nothing", () => {
    expect(readRequest("السلام عليكم", places)).toEqual({ kind: null, country: null, wantsHuman: false, salam: true });
  });
});

describe("the greeting", () => {
  it("greets by the Arabic first name, a kunya whole, never a business or Latin name", () => {
    expect(firstName("محمد العتيبي")).toBe("محمد");
    expect(firstName("أبو محمد")).toBe("أبو محمد");
    expect(firstName("Rana Graphic Designer | رنا مصممة جرافيك")).toBe("رنا");
    expect(firstName("Enjoy your Life")).toBeNull();
    expect(firstName("+966500000000")).toBeNull();
  });

  it("returns the salam, names the department, and says when the office opens out of hours", () => {
    expect(receptionText({ name: "محمد", salam: true, to: "تأشيرات", opensAt: null })).toBe(
      "وعليكم السلام ورحمة الله وبركاته، حياك الله محمد. أبشر، سيتم تحويل طلبك إلى قسم التأشيرات الآن.",
    );
    expect(receptionText({ name: null, salam: false, to: "موظف", opensAt: "09:00" })).toBe(
      "أهلاً وسهلاً، حياك الله. أبشر، سيتم تحويلك إلى أحد موظفينا الآن. وسيتواصل معك الموظف عند بداية الدوام الساعة 9:00 صباحاً.",
    );
    expect(clarifyText(true)).toBe("وعليكم السلام ورحمة الله، حياك الله، كيف نقدر نخدمك: بكج، تأشيرة، طيران، أو فندق؟");
  });
});

describe("the rule for one message", () => {
  const base = { routed: false, asked: false, staffReplied: false, canReply: true };
  const req = (over: Partial<ReturnType<typeof readRequest>> = {}) => ({ kind: null, country: null, wantsHuman: false, salam: true, ...over });

  it("a service named → handed over; a person asked for → handed over", () => {
    expect(decideReception({ ...base, request: req({ kind: "تأشيرات" }) })).toEqual({ act: "route", to: "تأشيرات" });
    expect(decideReception({ ...base, request: req({ wantsHuman: true, kind: "بكج" }) })).toEqual({ act: "route", to: "موظف" });
  });
  it("nothing named → one question, then whatever the answer is goes on", () => {
    expect(decideReception({ ...base, request: req() })).toEqual({ act: "ask" });
    expect(decideReception({ ...base, asked: true, request: req({ kind: "بكج" }) })).toEqual({ act: "route", to: "بكج" });
    expect(decideReception({ ...base, asked: true, request: req() })).toEqual({ act: "route", to: "غير واضح" });
  });
  it("a colleague who took it in hand while Murad waited keeps it", () => {
    expect(decideReception({ ...base, handedByHand: true, request: req({ kind: "بكج" }) })).toEqual({ act: "none", why: "assigned" });
  });
  it("never twice, never over a colleague, never outside the 24 hours", () => {
    expect(decideReception({ ...base, routed: true, request: req({ kind: "بكج" }) })).toEqual({ act: "none", why: "routed" });
    expect(decideReception({ ...base, staffReplied: true, request: req({ kind: "بكج" }) })).toEqual({ act: "none", why: "staff" });
    expect(decideReception({ ...base, canReply: false, request: req({ kind: "بكج" }) })).toEqual({ act: "none", why: "window" });
  });
});

describe("the working day, Riyadh time", () => {
  it("reads «09:00-23:00», the default when it does not read", () => {
    expect(parseHours("9:00-23:30")).toEqual({ open: "09:00", close: "23:30" });
    expect(parseHours("")).toEqual({ open: "09:00", close: "23:00" });
  });
  it("is open at 10:00 and closed at 03:00 Riyadh (07:00 and 00:00 UTC)", () => {
    const h = parseHours("09:00-23:00");
    expect(isWorkingTime(new Date("2026-10-18T07:00:00Z"), h)).toBe(true);
    expect(isWorkingTime(new Date("2026-10-18T00:00:00Z"), h)).toBe(false);
  });
});

describe("the department → team table", () => {
  const teams = [
    { id: 28, name: "متابعة المبيعات " },
    { id: 38, name: "قسم المبيعات " },
    { id: 1, name: "قسم فيزا" },
    { id: 25, name: "قسم الطلبات" },
  ];
  it("visas to «قسم فيزا», every travel request to «قسم المبيعات» (not the follow-up team), the rest to «قسم الطلبات»", () => {
    expect(suggestRoutes(teams)).toEqual({ تأشيرات: 1, بكج: 38, طيران: 38, فنادق: 38, مواصلات: 38, موظف: 25, "غير واضح": 25, fallback: 25 });
  });
  it("a saved table wins; an unrouted kind goes to the fallback", () => {
    const routes = readRoutes(JSON.stringify({ تأشيرات: 1, fallback: 25 }), teams);
    expect(teamFor(routes, "تأشيرات")).toBe(1);
    expect(teamFor(routes, "فنادق")).toBe(25);
    expect(teamFor({}, "فنادق")).toBeNull();
  });
});

describe("«تأخير بشري» (the owner, 2026-10-18)", () => {
  it("20–60 seconds unless set, within 0–90, min never above max", () => {
    expect(parseDelay("")).toEqual({ min: 20, max: 60 });
    expect(parseDelay("30-45")).toEqual({ min: 30, max: 45 });
    expect(parseDelay("50-20")).toEqual({ min: 50, max: 50 });
    expect(parseDelay("10-300")).toEqual({ min: 10, max: 90 });
  });
  it("one wait somewhere in the range", () => {
    expect(pickDelay({ min: 20, max: 60 }, 0)).toBe(20);
    expect(pickDelay({ min: 20, max: 60 }, 1)).toBe(60);
    expect(pickDelay({ min: 20, max: 60 }, 0.5)).toBe(40);
  });
});

describe("after the hand-over: «وصلت رسالتك» (the evaluator, 2026-10-19)", () => {
  it("names the colleague by first name and the department; the opening time out of hours; «زميلنا» with nobody yet", async () => {
    const { holdText } = await import("./reception");
    expect(holdText({ assignee: "احمد يوسف", team: "المبيعات", opensAt: null })).toBe("وصلت رسالتك، احمد من قسم المبيعات سيرد عليك خلال دقائق.");
    expect(holdText({ assignee: null, team: "قسم فيزا", opensAt: "09:00" })).toBe("وصلت رسالتك، زميلنا من قسم فيزا سيرد عليك عند بداية الدوام الساعة 9:00 صباحاً.");
    expect(holdText({ assignee: "خالد", team: null, opensAt: null })).toBe("وصلت رسالتك، خالد سيرد عليك خلال دقائق.");
  });
});

describe("the visit, from Teletel's own closing line (40029, 2026-10-19)", () => {
  it("the last «مغلقة» before the message, never one after it; 0 with none", async () => {
    const { lastClosedAt } = await import("./reception");
    const ev = [
      { kind: "activity", at: 100, text: 'تم تحديث حالة المحادثة لـ"مغلقة" بواسطة محمد اسكندر' },
      { kind: "client", at: 200, text: "السلام عليكم" },
      { kind: "activity", at: 210, text: "تم إسنادها إلى قسم المبيعات بواسطة احمد الرفاعي" },
      { kind: "activity", at: 400, text: 'تم تحديث حالة المحادثة لـ"مغلقة" بواسطة اسوار' },
    ];
    expect(lastClosedAt(ev, 300)).toBe(100);
    expect(lastClosedAt(ev, 500)).toBe(400);
    expect(lastClosedAt([], 300)).toBe(0);
  });
});

describe("destination-only travel requests", () => {
  const catalog = [...places, { name: "فيتنام", country: "فيتنام" }, { name: "الكويت", country: "الكويت" }];
  it.each(["فيتنام", "رحلة فيتنام", "فيتنام\nاسبوع\n7 نوفمبر\nشخصين"])("routes %s to packages", text => {
    expect(readRequest(text, catalog).kind).toBe("بكج");
  });
  it("does not mistake the departure country for a package request", () => {
    expect(readRequest("انا من الكويت", catalog).kind).toBeNull();
    expect(readRequest("تذاكر إلى فيتنام", catalog).kind).toBe("طيران");
  });
});
