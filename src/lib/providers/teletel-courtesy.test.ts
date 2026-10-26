import { describe, expect, it } from "vitest";
import { courtesyKind, isClosingCourtesy, ourLastAsked, waitingCourtesy, waitingIsCourtesy } from "./teletel-courtesy";

describe("closings: thanks, blessings, welcome, no problem, greetings back, farewells, emoji — whatever was said before", () => {
  const closing = [
    "شكرا", "شكراً لك", "شكرا جزيلا", "مشكور يا غالي", "جزاك الله خير", "جزاكم الله خيرا", "الله يعطيك العافية", "يعطيكم العافية", "تسلم ايدك", "تسلم", "الله يسلمك",
    "الله يسعدك", "ولا يهمك ياغالي", "ولا يهمك", "مو مشكله", "مافي مشكلة", "ما قصرت", "ماقصرتوا", "الله لا يحرمنا منك", "بارك الله فيك", "الله يوفقكم", "الحمد لله",
    "العفو", "عفوا", "على الرحب والسعة", "هلا فيك", "هلا والله", "اهلا وسهلا", "وعليكم السلام", "حياك الله", "صباح النور", "مع السلامة", "في امان الله", "تصبح على خير",
    "Thank you", "Thanks a lot", "thx", "ty", "Thank you so much", "much appreciated", "no problem", "bye",
    "🌹", "👍", "❤️❤️", "🙏", "😊", "شكرا 🌹", "يعطيك العافية 🌷", "تسلم 👍", "👍👍", ".", "🤝",
  ];
  for (const t of closing) it(`«${t}» closes`, () => expect(courtesyKind(t)).toBe("closing"));
});

describe("agreement: «تمام» closes only when our last message asked nothing", () => {
  for (const t of ["تمام", "تمام 👍", "اوكي", "اوکه", "أوكيه", "حاضر", "ابشر", "تمام فهمت عليك", "فهمت", "ماشي", "ان شاء الله", "ok", "okay", "تمام شكرا"]) {
    it(`«${t}» is agreement`, () => expect(courtesyKind(t)).toBe(t === "تمام شكرا" ? "agreement" : "agreement"));
  }
});

describe("never swallows a request, a question, an answer, a voice note or a file", () => {
  for (const t of ["شكرا بس كم السعر؟", "تمام وبكم الفندق", "ok send me the offer", "شكرا، ممكن تغيرون التاريخ", "هل يشمل الافطار", "", "اريد تعديل الحجز", "الو ؟", "كم يكون السعر", "ايه", "لا", "نعم", "صح", "السلام عليكم", "صباح الخير", "🎤 رسالة صوتية", "📎 ملف", "صالح", "ابي اسعار"]) {
    it(`«${t}» stays a request`, () => expect(courtesyKind(t)).toBeNull());
  }
});

describe("waiting that is only a closing", () => {
  const base = { waitingSince: 1000, firstReplyAt: 500, lastActivityAt: 1060, preview: "🌹" };
  it("a rose after our «عفواً» is not waiting", () => expect(waitingIsCourtesy(base)).toBe(true));
  it("a client's first-ever message is never a closing (we never answered)", () => expect(waitingIsCourtesy({ ...base, firstReplyAt: null })).toBe(false));
  it("an older unanswered streak keeps waiting even if it ends with thanks", () => expect(waitingIsCourtesy({ ...base, lastActivityAt: 1000 + 3600 })).toBe(false));
  it("a real message keeps waiting", () => expect(waitingIsCourtesy({ ...base, preview: "كم سعر الفندق؟" })).toBe(false));
  it("not waiting stays not waiting", () => expect(waitingIsCourtesy({ ...base, waitingSince: 0 })).toBe(false));
  it("an agreement is not decided here (it needs our last message)", () => {
    expect(waitingIsCourtesy({ ...base, preview: "تمام" })).toBe(false);
    expect(waitingCourtesy({ ...base, preview: "تمام" })).toBe("agreement");
  });
  it("isClosingCourtesy is the closing kind only", () => {
    expect(isClosingCourtesy("شكرا")).toBe(true);
    expect(isClosingCourtesy("تمام")).toBe(false);
  });
});

describe("ourLastAsked — did our last message ask for something?", () => {
  it("a question or a request is an ask", () => {
    for (const t of ["هل تريد حجز الفندق؟", "نحجز لك؟", "ارسل لي صورة الجواز", "ممكن تؤكد التواريخ", "كم عدد المسافرين", "نحتاج جوازات السفر", "بانتظار ردكم", "تبي نكمل الحجز"]) expect(ourLastAsked(t), t).toBe(true);
  });
  it("a statement or a farewell is not", () => {
    for (const t of ["عفوا", "تم ارسال العرض وهذا رابط البرنامج", "العفو، نحن بخدمتك دائما", "اهلا بك في ترافليون", "تم الحجز بنجاح"]) expect(ourLastAsked(t), t).toBe(false);
  });
});
