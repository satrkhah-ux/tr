import { describe, expect, it } from "vitest";
import { isSaudi, repeatsMurad, visaFreeText, VISA_CLOSING, visaAskText, visaFlowNote, visaFlowText, visaNeed, visaRowFor, type VisaFacts, type VisaRow } from "./visa";

const france: VisaRow = {
  country: "فرنسا",
  visa_type: "تأشيرة سياحية",
  sell_price: 400,
  sell_currency: "SAR",
  arabic_requirements: "1- الجواز الاصل صالح لمده 6 شهور\n\n2- صورة بطاقة الاحوال\nالسعر بتحولنا 400 ريال وبتدفع بالسفارة حوالي 400 ريال",
  status: "Active",
};
const china: VisaRow = { ...france, country: "الصين", sell_price: null, arabic_requirements: "الصين\n\n1-    الجواز الأصلي\nالسعر يختلف حسب الجنسيه" };
const full: VisaFacts = { country: "فرنسا", nationality: "سعودي", applicants: 2, travelDate: null };

describe("Murad's visa flow — the owner's decision, 2026-10-22", () => {
  it("step 1: asks once, only for what is missing of country, nationality, applicants", () => {
    expect(visaNeed(full)).toEqual([]);
    expect(visaNeed({ ...full, nationality: null, applicants: null })).toEqual(["nationality", "applicants"]);
    expect(visaAskText({ ...full, nationality: null, applicants: null }, ["nationality", "applicants"])).toBe("حياك الله، عشان أجهز لك تفاصيل تأشيرة فرنسا: تكرماً الجنسية، وعدد المتقدمين؟");
    expect(visaAskText({ country: null, nationality: null, applicants: null, travelDate: null, schengen: true }, ["country"], ["فرنسا", "إسبانيا"])).toContain("(عندنا فرنسا وإسبانيا)");
  });
  it("«تعملون تأشيرات؟» is answered before the asking; a visa-free country is said so (the owner's test, 2026-10-22)", () => {
    expect(visaAskText({ country: null, nationality: null, applicants: null, travelDate: null }, ["country", "nationality", "applicants"])).toBe("أكيد نخدمك في التأشيرات، عشان أجهز لك التفاصيل: تكرماً الدولة المطلوبة، والجنسية، وعدد المتقدمين؟");
    expect(visaFreeText("ماليزيا")).toContain("ما يحتاج تأشيرة مسبقة لـماليزيا");
    expect(isSaudi("سعودي")).toBe(true);
    expect(isSaudi("يمني")).toBe(false);
    expect(isSaudi(null)).toBe(false);
  });

  it("step 2: the list's price for the party and the requirements VERBATIM, then the hand-over line", () => {
    const text = visaFlowText({ row: france, facts: full, includePrice: true, salam: false });
    expect(text).toContain("💰 السعر: 400 ريال للشخص × شخصين = 800 ريال");
    expect(text).toContain(france.arabic_requirements!);
    expect(text).not.toContain("حسب الجنسية");
    expect(text.endsWith(VISA_CLOSING)).toBe(true);
  });

  it("unanswered: per person, «حسب الجنسية» noted", () => {
    const text = visaFlowText({ row: france, facts: { ...full, nationality: null, applicants: null }, includePrice: true, salam: false });
    expect(text).toContain("💰 السعر: 400 ريال للشخص\n(السعر حسب الجنسية)");
  });

  it("no price on the list (China, Morocco): no number, «السعر يحدده زميلنا»", () => {
    const text = visaFlowText({ row: china, facts: full, includePrice: true, salam: false });
    expect(text).toContain("💰 السعر يحدده زميلنا.");
    expect(text).not.toMatch(/\d+ ريال للشخص/);
    expect(text).toContain(china.arabic_requirements!.trim());
  });

  it("a country not on the list: no price, no requirements — straight to the hand-over", () => {
    expect(visaFlowText({ row: null, facts: { ...full, country: "كندا" }, includePrice: true, salam: true })).toBe(`وعليكم السلام ورحمة الله، ${VISA_CLOSING}`);
    expect(visaFlowNote({ facts: { ...full, country: "كندا" }, row: null, includePrice: true })).toContain("الدولة ليست في قائمة التأشيرات");
  });

  it("prices hidden in «إعدادات مُراد»: no figure anywhere", () => {
    const text = visaFlowText({ row: france, facts: full, includePrice: false, salam: false });
    expect(text).not.toMatch(/\d+ ريال/);
    expect(text).toContain("الجواز الاصل صالح لمده 6 شهور");
  });

  it("the private note: country, nationality, applicants, date when given, the price quoted", () => {
    expect(visaFlowNote({ facts: { ...full, travelDate: "2026-12-01" }, row: france, includePrice: true })).toBe(
      "🤖 مُراد — طلب تأشيرة\nالدولة: فرنسا\nالجنسية: سعودي\nعدد المتقدمين: 2\nتاريخ السفر: 2026-12-01\nالسعر المرسل: 400 ريال للشخص × شخصين = 800 ريال",
    );
  });

  it("the list's row: by country id or name, the tourist visa first, inactive rows ignored", () => {
    const rows = [{ ...france, visa_type: "تأشيرة عمل", country_id: "fr" }, { ...france, country_id: "fr" }, { ...france, country: "مصر", country_id: "eg", status: "Inactive" }];
    expect(visaRowFor(rows, "fr", null)?.visa_type).toBe("تأشيرة سياحية");
    expect(visaRowFor(rows, null, "فرنسا")?.visa_type).toBe("تأشيرة سياحية");
    expect(visaRowFor(rows, "eg", "مصر")).toBeNull();
  });

  it("never the same line twice in a visit", () => {
    const murad = { id: 2, at: 101, text: "تأشيرة فرنسا — تأشيرة سياحية\n…", fromClient: false, isPrivate: false, template: false, bot: false };
    expect(repeatsMurad(visaFlowText({ row: france, facts: full, includePrice: true, salam: false }), [murad])).toBe(true);
    expect(repeatsMurad("رد جديد", [murad])).toBe(false);
  });
});
