import { describe, expect, it } from "vitest";
import { isClosingCourtesy, waitingIsCourtesy } from "./teletel-courtesy";

describe("isClosingCourtesy — what a client sends to close the talk", () => {
  it("knows thanks, blessings, agreement and emoji", () => {
    for (const t of ["شكرا", "شكراً لك", "شكرا جزيلا", "مشكور يا غالي", "جزاك الله خير", "الله يعطيك العافية", "تسلم ايدك", "تمام", "اوكي", "ok", "Thank you so much", "🌹", "👍", "❤️❤️", "🙏", "شكرا 🌹", "يعطيك العافية 🌷"]) expect(isClosingCourtesy(t), t).toBe(true);
  });
  it("never swallows a request or a question", () => {
    for (const t of ["شكرا بس كم السعر؟", "تمام وبكم الفندق", "ok send me the offer", "شكرا، ممكن تغيرون التاريخ", "هل يشمل الافطار", "", "اريد تعديل الحجز"]) expect(isClosingCourtesy(t), t).toBe(false);
  });
});

describe("waitingIsCourtesy — only when we had answered and the streak is the courtesy itself", () => {
  const base = { waitingSince: 1000, firstReplyAt: 500, lastActivityAt: 1060, preview: "🌹" };
  it("a rose after our «عفواً» is not waiting", () => expect(waitingIsCourtesy(base)).toBe(true));
  it("a client's first-ever message is never courtesy (we never answered)", () => expect(waitingIsCourtesy({ ...base, firstReplyAt: null })).toBe(false));
  it("an older unanswered streak keeps waiting even if it ends with thanks", () => expect(waitingIsCourtesy({ ...base, lastActivityAt: 1000 + 3600 })).toBe(false));
  it("a real message keeps waiting", () => expect(waitingIsCourtesy({ ...base, preview: "كم سعر الفندق؟" })).toBe(false));
  it("not waiting stays not waiting", () => expect(waitingIsCourtesy({ ...base, waitingSince: 0 })).toBe(false));
});
