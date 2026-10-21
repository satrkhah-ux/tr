import { describe, it, expect } from "vitest";
import { latestClientQuestion, visaPriceAnswer, futureImageReview } from "./visa-response";
const m = (id: number, text: string, fromClient = true, isPrivate = false) => ({ id, at: id, text, fromClient, isPrivate, template: false, bot: false });
describe("visa direct answers", () => {
  it("keeps the price question sent after the passport, excluding private notes", () => {
    expect(latestClientQuestion([m(1, "طلب", false), m(2, "📎"), m(3, "وكم السعر ؟"), m(4, "ملاحظة", false, true)])).toBe("📎\nوكم السعر ؟");
  });
  it("answers an unpriced request explicitly, never inventing zero or a quote", () => {
    const text = visaPriceAnswer("المغرب", [{ country: "المغرب", sell_price: null, sell_currency: "SAR" }], true);
    expect(text).toContain("لا يوجد سعر معتمد");
    expect(text).not.toContain("0 SAR");
  });
  it("only quotes the matching country and respects hidden prices", () => {
    const rows = [{ country: "فرنسا", sell_price: 700, sell_currency: "SAR" }, { country: "المغرب", sell_price: 300, sell_currency: "SAR" }];
    expect(visaPriceAnswer("فرنسا", rows, true)).toContain("700 SAR");
    expect(visaPriceAnswer("فرنسا", rows, true)).not.toContain("300");
    expect(visaPriceAnswer("فرنسا", rows, false)).not.toContain("700");
  });
  it("rejects promises to review instead of the actual finding", () => {
    for (const text of ["سأقوم بمراجعة الصورة الآن", "سوف أراجع الجواز", "سأفحص الصورة"]) expect(futureImageReview(text)).toBe(true);
    expect(futureImageReview("صورة الجواز واضحة وتظهر الصفحة كاملة")).toBe(false);
  });
});
