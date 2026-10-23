import { describe, expect, it } from "vitest";
import { isSaudi, repeatsMurad, VISA_FREE_ASK, VISA_WHICH_COUNTRY, visaFacts, visaFreeText, VISA_CLOSING, visaAskText, visaFlowNote, visaFlowText, visaNeed, visaRowFor, visaStep, type VisaAsk, type VisaCountry, type VisaFacts, type VisaRow } from "./visa";
import { withoutAd } from "./reception";

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

describe("visaStep — the questions of 120 real visa conversations (2026-10-23)", () => {
  const countries: VisaCountry[] = [
    { id: "ae", arabic_name: "الإمارات العربية المتحدة", iso2: "AE", visa_required: false },
    { id: "ge", arabic_name: "جورجيا", iso2: "GE", visa_required: false },
    { id: "fr", arabic_name: "فرنسا", iso2: "FR", visa_required: true },
    { id: "in", arabic_name: "الهند", iso2: "IN", visa_required: true },
    { id: "sa", arabic_name: "السعودية", iso2: "SA", visa_required: false },
  ];
  const rows = [
    { ...france, country_id: "fr" },
    { ...france, country: "الإمارات العربية المتحدة", country_id: "ae", arabic_requirements: "صورة الجواز\nصورة شخصيه" },
    { ...france, country: "الهند", country_id: "in", sell_price: 200, arabic_requirements: "صورة الجواز\nصورة شخصيه" },
  ];
  const ask = (over: Partial<VisaAsk> = {}): VisaAsk => ({ country: null, kind: "tourist", nationality: null, nationality_ar: null, applicants: null, travel_date: null, refused_before: null, special: null, others: [], ...over });
  const step = (a: VisaAsk | null, facts: Partial<VisaFacts>, asked = false, clientText = "") =>
    visaStep({ a, facts: { country: null, nationality: null, applicants: null, travelDate: null, ...facts }, asked, countries, rows, includePrice: true, clientText });

  it("a Saudi to a visa-free country is told so — even where the list prices it for residents, and before any count", () => {
    expect(step(ask(), { country: "الإمارات العربية المتحدة", nationality: "سعودي" })).toEqual({ do: "free", country: "الإمارات العربية المتحدة" });
    expect(step(ask({ others: [{ nationality: "YEM", nationality_ar: "يمني", resident: true }] }), { country: "الإمارات العربية المتحدة", nationality: "سعودي", applicants: 2 })).toMatchObject({ do: "answer" });
    expect(step(ask(), { country: "الإمارات العربية المتحدة", nationality: "يمني", applicants: 1 })).toMatchObject({ do: "answer", row: { country: "الإمارات العربية المتحدة" } });
  });
  it("on arrival and an e-visa not on our list: answered, no hand-over; an e-visa on our list is ours (the owner, 2026-10-23)", () => {
    const more: VisaCountry[] = [...countries, { id: "mv", arabic_name: "المالديف", iso2: "MV", visa_required: false, saudi_entry: "arrival" }, { id: "lk", arabic_name: "سريلانكا", iso2: "LK", visa_required: true, saudi_entry: "evisa" }];
    const at = (country: string, list = more) => visaStep({ a: ask(), facts: { country, nationality: "سعودي", applicants: 1, travelDate: null }, asked: true, countries: list, rows, includePrice: true });
    expect(at("المالديف")).toEqual({ do: "free", country: "المالديف", entry: "arrival" });
    expect(at("سريلانكا")).toEqual({ do: "free", country: "سريلانكا", entry: "evisa" });
    expect(at("الهند", more.map((c) => (c.id === "in" ? { ...c, saudi_entry: "evisa" as const } : c)))).toMatchObject({ do: "answer", row: { country: "الهند" } });
    expect(visaFreeText("المالديف", "arrival")).toContain("عند الوصول");
  });
  it("a request already with the team, a visa into Saudi Arabia, a work visa: the team's, never the tourist price", () => {
    expect(step(ask({ status_query: true }), {})).toEqual({ do: "answer", row: null });
    expect(step(ask({ inbound: true }), { country: "السعودية" })).toEqual({ do: "answer", row: null });
    expect(step(ask({ kind: "work" }), { country: "فرنسا", nationality: "يمني", applicants: 1, kind: "work" })).toEqual({ do: "answer", row: null });
  });
  it("«أسهل تأشيرة»: the advice from the list — light papers only, never an acceptance rate — then the one question", () => {
    const s = step(ask({ advice: "easiest" }), {});
    expect(s.do).toBe("ask");
    const text = (s as { text: string }).text;
    // no nationality yet: the Saudi passport's parts, then the resident's — the list's e-visas are ours, never «easy»
    expect(text).toContain("إذا جوازك سعودي:");
    expect(text).toContain("✅ بدون تأشيرة: الإمارات العربية المتحدة، جورجيا");
    expect(text).toContain("وإذا كنت مقيم: الدخول بدون تأشيرة أو عند الوصول يعتمد على جنسية جوازك");
    expect(text).toContain("ومن التأشيرات اللي نطلعها لك بدون حضور سفارة: الإمارات العربية المتحدة، الهند.");
    expect(text).not.toContain("💻");
    expect(text).not.toMatch(/نسب[ةه]/);
    expect(text).toContain("أي دولة تفضّل؟ وتكرماً الجنسية، وعدد المتقدمين؟");
    const saudi = (step(ask({ advice: "easiest" }), { nationality: "سعودي" }) as { text: string }).text;
    expect(saudi).toContain("للجواز السعودي:");
    expect(saudi).not.toContain("مقيم");
    expect((step(ask({ advice: "cheapest" }), { nationality: "يمني" }) as { text: string }).text).toContain("الأقل سعراً عندنا: الهند 200 ريال، فرنسا 400 ريال، الإمارات العربية المتحدة 400 ريال.");
    // a Saudi never sees the residents' price of a country he enters free
    expect((step(ask({ advice: "cheapest" }), { nationality: "سعودي" }) as { text: string }).text).toContain("الأقل سعراً عندنا: الهند 200 ريال، فرنسا 400 ريال.");
    // the model missed it, the words did not
    expect(step(ask(), {}, false, "أي تأشيرة ما تحتاج كشف حساب؟").do).toBe("ask");
    expect((step(ask(), {}, false, "أي تأشيرة ما تحتاج كشف حساب؟") as { text: string }).text).toContain("بدون حضور سفارة");
  });
  it("the facts: a country the client never wrote is dropped; a short name counts; «شنغن (أوروبا)» asks which state; transit is no tourist visa", () => {
    const f = (a: VisaAsk, clientText: string, said: string | null = null) => visaFacts({ a, clientText, said, before: null, countries });
    expect(f(ask({ country: "ماليزيا" }), "اسهل تأشيرة لأي دولة").country).toBeNull();
    expect(f(ask({ country: "الإمارات العربية المتحدة" }), "تاشيرة الامارات سياحة").country).toBe("الإمارات العربية المتحدة");
    expect(f(ask({ country: "قيرغيزستان" }), "بدي اقدم فيزا لقركزستان").country).toBe("قيرغيزستان");
    expect(f(ask(), "ابغى تأشيرة شنغن", "شنغن (أوروبا)")).toMatchObject({ country: null, schengen: true });
    expect(f(ask({ country: "الهند" }), "هندي عبور فقط من البحرين الى الهند").kind).toBe("other");
    expect(f(ask({ advice: "easiest", schengen: true }), "اليونان - إيطاليا - إسبانيا أيها أسهل", "إيطاليا").country).toBeNull();
  });
  it("a question the list cannot answer is said back and noted", () => {
    const facts: VisaFacts = { ...full, topics: ["time", "guarantee", "requirements"] };
    expect(visaFlowText({ row: france, facts, includePrice: true, salam: false })).toContain("وسؤالك عن مدة الإصدار وضمان القبول يجاوبك عليه زميلنا.");
    expect(visaFlowNote({ facts: { ...facts, refused: true, kind: "work" }, row: null, includePrice: true })).toContain("يسأل عن: مدة الإصدار وضمان القبول");
  });
  it("the ad's slogan and audience are not the client's words", () => {
    expect(withoutAd("مرحبا بكم في ترافليون ✈️| احجز بكجات سفر مع ترافليون انا مهتم بـ تأشيرة أمريكا السياحية للسعوديين والمقيمين | ترافليون")).not.toMatch(/بكجات|سعوديين|مقيمين/);
    expect(VISA_FREE_ASK.test("أي دولة اقدر اسافر لها بدون فيزا؟")).toBe(true);
  });
});

describe("the owner's test of 2026-10-23 00:45 — «اسهل دولة» then «كم السعر؟»", () => {
  const countries: VisaCountry[] = [{ id: "ge", arabic_name: "جورجيا", iso2: "GE", visa_required: false }];
  const a: VisaAsk = { country: null, kind: "tourist", nationality: "SAU", nationality_ar: "سعودي", applicants: null, travel_date: null, refused_before: null, special: null, others: [] };
  const facts: VisaFacts = { country: null, nationality: "سعودي", applicants: null, travelDate: null };
  const step = (asks: number, clientText: string, ask: VisaAsk | null = a) => visaStep({ a: ask, facts, asked: asks > 0, asks, countries, rows: [], includePrice: true, clientText });
  it("the advice still comes after the first question, and is marked as advice", () => {
    expect(step(1, "اسهل دولة")).toMatchObject({ do: "ask", advice: true });
  });
  it("no country yet and the client still writing: the country alone, not a blind hand-over — at most three asks", () => {
    expect(step(2, "كم السعر ؟")).toEqual({ do: "ask", text: VISA_WHICH_COUNTRY });
    expect(step(3, "كم السعر ؟")).toEqual({ do: "answer", row: null });
    // the unanswered follow-through hands over
    expect(step(1, "", null)).toEqual({ do: "answer", row: null });
  });
});
