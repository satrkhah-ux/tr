import { describe, expect, it } from "vitest";
import { notNeededText, splitRequirements, visaAnswerText, visaAskText, visaHandoffReason, visaMissing, visaSummary, type VisaAsk, type VisaRow } from "./visa";

const none: VisaAsk = { country: null, kind: null, nationality: null, nationality_ar: null, applicants: null, travel_date: null, refused_before: null, special: null };
const uk: VisaRow = {
  country: "المملكة المتحدة",
  visa_type: "تأشيرة سياحية",
  sell_price: 850,
  sell_currency: "SAR",
  arabic_requirements: "1- الجواز الاصل صالح لمده 6 شهور\n\n2- صورة بطاقة الاحوال\n\n3- كشف حساب بنكي لأخر 6 شهور\nالسعر 850 ريال شامله رسوم  السفارة",
  status: "Active",
};

describe("Murad as a visa clerk (the owner, 2026-10-19)", () => {
  it("asks only for what is missing; the travel date once, never required", () => {
    expect(visaMissing({ ...none, country: "المملكة المتحدة" }, false)).toEqual(["nationality", "applicants", "travel_date"]);
    expect(visaMissing({ ...none, country: "المملكة المتحدة", nationality: "SAU", applicants: 2 }, true)).toEqual([]);
    expect(visaAskText("المملكة المتحدة", ["nationality", "applicants", "travel_date"], true)).toBe(
      "حياك الله، عشان أجهز لك تفاصيل تأشيرة المملكة المتحدة: تكرماً الجنسية، وعدد المتقدمين، وتاريخ السفر التقريبي؟",
    );
    expect(visaAskText(null, ["country"], false)).toBe("شكراً لك، باقي فقط: الدولة المطلوبة؟");
  });

  it("answers from the list: the price for the party, the price notes, the documents renumbered", () => {
    const text = visaAnswerText({ country: "المملكة المتحدة", row: uk, applicants: 2, sarPer: 1, check: false });
    expect(text).toContain("💰 السعر: 850 ريال للشخص × شخصين = 1,700 ريال");
    expect(text).toContain("• السعر 850 ريال شامله رسوم السفارة");
    expect(text).toContain("1- الجواز الاصل صالح لمده 6 شهور");
    expect(text).toContain("3- كشف حساب بنكي لأخر 6 شهور");
    expect(text).toContain("القبول قرار السفارة");
  });

  it("splits the staff text: a heading that repeats the country, «السعر» alone and blank lines dropped; time goes with the notes", () => {
    expect(splitRequirements("الصين\n\n1-    الجواز الأصلي\nالسعر\nشهر 200 ريال\nوقت الانجاز اسبوع عمل", "الصين")).toEqual({
      docs: ["الجواز الأصلي"],
      notes: ["شهر 200 ريال", "وقت الانجاز اسبوع عمل"],
    });
  });

  it("hands over, with the reason, what the list cannot answer", () => {
    expect(visaHandoffReason({ ...none, kind: "study" }, uk, "required")).toBe("تأشيرة دراسة");
    expect(visaHandoffReason({ ...none, kind: "tourist", refused_before: true }, uk, "required")).toBe("رفض سابق");
    expect(visaHandoffReason({ ...none, kind: "tourist" }, null, "required")).toBe("تأشيرة هذه الدولة يجهزها زميلنا مباشرة");
    expect(visaHandoffReason({ ...none }, { ...uk, sell_price: null }, "check")).toBe("السعر حسب الجنسية، يحدده زميلنا بعد مراجعة الطلب");
    expect(visaHandoffReason({ ...none, kind: "tourist" }, uk, "required")).toBeNull();
  });

  it("no visa needed: said plainly, a package offered", () => {
    expect(notNeededText("جورجيا", "سعودي")).toBe("حامل الجواز السعودي لا يحتاج تأشيرة مسبقة لدخول جورجيا. وإذا تحب نجهز لك برنامج سياحي لـجورجيا، أرسل لي عدد الأيام وعدد الأشخاص.");
  });

  it("one line of what was understood", () => {
    expect(visaSummary({ ...none, country: "المملكة المتحدة", nationality_ar: "سعودي", applicants: 2, travel_date: "2026-12-01" })).toBe("المملكة المتحدة، سياحية، سعودي، شخصين، السفر 1/12");
  });
});

describe("the next step, in a clerk's order (the owner's acceptance cases, 2026-10-19)", () => {
  const ukCountry = { known: true, required: true, status: "required", row: uk, asks: 0 };
  it("(a) UK: the nationality, the party and the date first, then the answer", async () => {
    const { visaStep } = await import("./visa");
    expect(visaStep({ ...none, country: "المملكة المتحدة", kind: "tourist" }, ukCountry)).toEqual({ act: "ask", need: ["nationality", "applicants", "travel_date"] });
    expect(visaStep({ ...none, country: "المملكة المتحدة", kind: "tourist", nationality: "SAU", applicants: 2, travel_date: "2026-12-01" }, { ...ukCountry, asks: 1 })).toEqual({ act: "answer" });
  });
  it("(b) a Saudi to Georgia: «لا تحتاج تأشيرة» at once, nothing else asked", async () => {
    const { visaStep } = await import("./visa");
    expect(visaStep({ ...none, country: "جورجيا", kind: "tourist", nationality: "SAU" }, { known: true, required: false, status: "not_required", row: null, asks: 0 })).toEqual({ act: "not_needed" });
    // the nationality decides it — asked first
    expect(visaStep({ ...none, country: "جورجيا", kind: "tourist" }, { known: true, required: false, status: "not_required", row: null, asks: 0 })).toMatchObject({ act: "ask" });
  });
  it("(c) a country the list does not price, a study visa, a refusal: a colleague at once", async () => {
    const { visaStep } = await import("./visa");
    expect(visaStep({ ...none, country: "اليابان" }, { known: true, required: true, status: "required", row: null, asks: 0 })).toEqual({ act: "handoff", reason: "تأشيرة هذه الدولة يجهزها زميلنا مباشرة" });
    expect(visaStep({ ...none, country: "المملكة المتحدة", kind: "study" }, ukCountry)).toEqual({ act: "handoff", reason: "تأشيرة دراسة" });
    expect(visaStep({ ...none, country: "المملكة المتحدة", refused_before: true }, ukCountry)).toEqual({ act: "handoff", reason: "رفض سابق" });
    expect(visaStep({ ...none, country: "واكاندا" }, { known: false, required: null, status: "check", row: null, asks: 0 })).toMatchObject({ act: "handoff" });
  });
  it("no price in the list (الصين، المغرب): never 0 — the colleague sets it", async () => {
    const { visaStep } = await import("./visa");
    expect(visaStep({ ...none, country: "الصين", nationality: "EGY", applicants: 3 }, { known: true, required: true, status: "check", row: { ...uk, country: "الصين", sell_price: null }, asks: 0 })).toEqual({
      act: "handoff",
      reason: "السعر حسب الجنسية، يحدده زميلنا بعد مراجعة الطلب",
    });
  });
});

describe("the general visa questions (the owner's twelve, 2026-10-19)", () => {
  it("«وش المطلوب لتأشيرة فرنسا؟»: the list answers now, the start asked after", async () => {
    const { visaStep, visaAnswerText } = await import("./visa");
    const step = visaStep({ ...none, country: "المملكة المتحدة", kind: "tourist", topics: ["requirements"] }, { known: true, required: true, status: "required", row: uk, asks: 0 });
    expect(step).toEqual({ act: "info", need: ["nationality", "applicants", "travel_date"] });
    const text = visaAnswerText({ country: "المملكة المتحدة", row: uk, applicants: null, sarPer: 1, check: true, need: step.act === "info" ? step.need : [] });
    expect(text).toContain("💰 السعر: 850 ريال للشخص\n");
    expect(text).toContain("وللبدء بطلبك تكرماً: الجنسية، وعدد المتقدمين، وتاريخ السفر التقريبي؟");
  });
  it("time, appointment, fingerprints only when the list says them; validity and refund never — the colleague", async () => {
    const { uncoveredTopics } = await import("./visa");
    expect(uncoveredTopics(["time", "fingerprints", "refund", "validity", "guarantee"], "وقت الانجاز اسبوع عمل\nقبل التبصيم بي 3 ايام")).toEqual(["استرداد المبلغ عند الرفض", "مدة صلاحية التأشيرة"]);
    expect(uncoveredTopics(["time", "appointment"], "صورة الجواز")).toEqual(["مدة الإصدار", "الموعد والمقابلة"]);
  });
  it("«شنغن» alone: which country they enter first, ours named", async () => {
    const { visaAskText } = await import("./visa");
    expect(visaAskText(null, ["country", "nationality"], true, ["فرنسا", "إسبانيا"])).toBe(
      "حياك الله، عشان أجهز لك تفاصيل التأشيرة: تكرماً دولة الشنغن التي ستدخلها أولاً أو تقيم فيها أطول مدة (عندنا فرنسا وإسبانيا)، والجنسية؟",
    );
  });
  it("never assume a Saudi: another passport is asked whether it lives here", async () => {
    const { visaMissing } = await import("./visa");
    expect(visaMissing({ ...none, country: "تايلاند", nationality: "EGY", applicants: 1 }, true)).toEqual(["residence"]);
    expect(visaMissing({ ...none, country: "تايلاند", nationality: "EGY", resident: true, applicants: 1 }, true)).toEqual([]);
  });
  it("«وين وصلت تأشيرتي؟»: the visa team at once", async () => {
    const { visaStep } = await import("./visa");
    expect(visaStep({ ...none, status_query: true }, { known: false, required: null, status: "check", row: null, asks: 0 })).toEqual({ act: "handoff", reason: "متابعة طلب قائم" });
  });
  it("the owner's own test: an Iraqi resident and a Saudi friend to London", () => {
    expect(visaSummary({ ...none, country: "المملكة المتحدة", kind: "tourist", nationality: "IRQ", nationality_ar: "عراقي", resident: true, others: [{ nationality: "SAU", nationality_ar: "سعودي", resident: null }], applicants: 2 })).toBe(
      "المملكة المتحدة، سياحية، عراقي مقيم + سعودي، شخصين",
    );
  });
});
