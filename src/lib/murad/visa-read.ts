import { isOpenAIConfigured, openaiJson } from "@/lib/providers/openai";
import { datesSaid } from "./auto-offer";
import { withoutAd } from "./reception";
import { ADVICE, type VisaAsk } from "./visa";

/**
 * A visa request from the whole visit (the owner, 2026-10-19: «كأن مراد موظف
 * تأشيرات»): the destination as our list spells it — never the client's own
 * country («مقيم في السعودية» is where they live) — the kind, each passport
 * among the applicants (the writer's, and others' when they differ: «عراقي
 * مقيم… وصديق لي سعودي»), the party, an approximate date, what they asked
 * about, a refusal before, a request already with the team. Only the client's
 * words are facts; a date counts only when the client named one. Null on any
 * failure: the request then goes to the visa team like any other.
 */
export async function readVisa(transcript: string, clientText: string, countryNames: string[]): Promise<VisaAsk | null> {
  if (!isOpenAIConfigured()) return null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  try {
    const raw = await openaiJson({
      name: "visa_facts",
      system: [
        `Today is ${today} (Riyadh). Below is one visit of a client's WhatsApp conversation with a travel company in Saudi Arabia, oldest first: «العميل» lines are the client's, «مُراد» lines are our assistant's. The client is asking about a visa. Extract what the client wants NOW: a later client line replaces an earlier one. When the latest client line names another country («وإسبانيا؟», «طيب وايطاليا؟») that country IS the destination now, and the nationality, the applicants and the date said before carry over to it. Only the client's lines are facts.`,
        `country: the DESTINATION country, spelled as one of: ${countryNames.join("، ")} — or as the client wrote it when it is none of them — never another country of that list for a name it lacks (قركزستان is قيرغيزستان, not كازاخستان — a country missing from that list is still the destination) (a city means its country: لندن → المملكة المتحدة, باريس → فرنسا; امريكا → الولايات المتحدة; بريطانيا → المملكة المتحدة). Never the country the client lives in or holds a passport of. null when only «شنغن» is said.`,
        "A transit visa («عبور», «ترانزيت») is for the country passed through — «عبور البحرين الى الهند»: البحرين, kind other. The client's own home country is never the destination («من البحرين الى الهند» for an Indian: البحرين).",
        "schengen: true when the client says شنغن without naming one country.",
        "kind: tourist (the default for تأشيرة/فيزا/فيزه/زيارة/سياحة), medical, study, work, family (to join a relative), other.",
        "nationality: ISO 3166-1 alpha-3 of the writer's passport, only when said («سعودي» = SAU, «عراقي» = IRQ; «مقيم» alone is no nationality); nationality_ar: as an Arabic adjective («عراقي»); resident: true when the writer lives in Saudi Arabia on an إقامة, else null.",
        "others: the other applicants whose passport differs from the writer's, one item per nationality — {nationality (alpha-3), nationality_ar, resident} («وصديق لي سعودي» → SAU). Empty when all share the writer's.",
        "applicants: how many people apply in all («انا وزوجتي» = 2, «انا وصديقي» = 2), children included. travel_date: approximate travel date YYYY-MM-DD in the future (a month alone = the 1st of the next such month; relative dates from today).",
        "topics: what the client asks about — requirements, price, time (how long it takes), appointment (موعد/مقابلة), fingerprints (بصمة), validity (how long the visa lasts), refund (if refused), guarantee (is approval guaranteed).",
        "status_query: true when the client asks where an existing request stands («وين وصلت تأشيرتي»). wants_trip: true when the client also asks for a trip or package. refused_before: true only when the client says a visa WAS refused in the past («انرفضت قبل»); a question about what happens if refused («لو انرفضت») is the refund topic, not a refusal. special: a short Arabic phrase for anything unusual (urgent, a minor alone, an expired passport), else null.",
        "advice: when no single destination is chosen and the client asks us to pick — the easiest visa, the fewest requirements (no bank statement, no salary letter, no attendance), the fastest, the cheapest, the highest acceptance, or any country will do («اسهل تأشيرة», «اي دولة مش شرط», «وين نسبة القبول اعلى») — easiest, fastest or cheapest; else null. A client comparing countries he named («ايطاليا ولا اسبانيا أسهل») is advice too, with country null.",
        "inbound: true when the visa is for someone to come INTO Saudi Arabia (a visit or tourist visa for Saudi Arabia, bringing a relative or a worker here).",
        "An ad's form («عدد المتقدمين: _», «الجنسية: _») with «_» is unanswered; an ad's title says whom the ad is for («للمقيمين», «للسعوديين والمقيمين») — never the client's nationality nor the applicants. A visa ad («انا مهتم بـ تأشيرة …») is no trip: wants_trip only when the client asks for flights, hotels or a package themselves.",
        "null or empty for anything not said. Never invent.",
      ].join("\n"),
      user: withoutAd(transcript).slice(-3000),
      schema: {
        type: "object",
        properties: {
          country: { type: ["string", "null"] },
          schengen: { type: ["boolean", "null"] },
          kind: { type: ["string", "null"], enum: ["tourist", "medical", "study", "work", "family", "other", null] },
          nationality: { type: ["string", "null"] },
          nationality_ar: { type: ["string", "null"] },
          resident: { type: ["boolean", "null"] },
          others: {
            type: "array",
            items: {
              type: "object",
              properties: { nationality: { type: "string" }, nationality_ar: { type: ["string", "null"] }, resident: { type: ["boolean", "null"] } },
              required: ["nationality", "nationality_ar", "resident"],
              additionalProperties: false,
            },
          },
          applicants: { type: ["integer", "null"] },
          travel_date: { type: ["string", "null"] },
          topics: { type: "array", items: { type: "string", enum: ["requirements", "price", "time", "appointment", "fingerprints", "validity", "refund", "guarantee"] } },
          status_query: { type: ["boolean", "null"] },
          wants_trip: { type: ["boolean", "null"] },
          refused_before: { type: ["boolean", "null"] },
          special: { type: ["string", "null"] },
          advice: { type: ["string", "null"], enum: ["easiest", "fastest", "cheapest", null] },
          inbound: { type: ["boolean", "null"] },
        },
        required: ["country", "schengen", "kind", "nationality", "nationality_ar", "resident", "others", "applicants", "travel_date", "topics", "status_query", "wants_trip", "refused_before", "special", "advice", "inbound"],
        additionalProperties: false,
      },
      temperature: 0,
      timeoutMs: 15000,
    });
    const r = JSON.parse(raw ?? "{}") as VisaAsk;
    // the model writes «null» as a string at times
    for (const k of ["country", "nationality", "nationality_ar", "travel_date", "special"] as const) if (r[k] === "null" || r[k] === "") r[k] = null;
    const iso3 = (s: string | null | undefined) => (s && /^[A-Za-z]{3}$/.test(s) ? s.toUpperCase() : null);
    const date = r.travel_date && /^\d{4}-\d{2}-\d{2}$/.test(r.travel_date) && r.travel_date >= today && datesSaid(clientText) > 0 ? r.travel_date : null;
    const nat = iso3(r.nationality);
    const others = (r.others ?? []).map((o) => ({ ...o, nationality: iso3(o.nationality) ?? "" })).filter((o) => o.nationality && o.nationality !== nat);
    return { ...r, nationality: nat, nationality_ar: nat ? r.nationality_ar : null, others, travel_date: date, applicants: r.applicants && r.applicants > 0 ? r.applicants : null };
  } catch {
    return null;
  }
}

/**
 * A visa question the price list does not answer, from the company's own
 * «أسئلة وأجوبة التأشيرات» (/murad-settings, the owner's file of 2026-10-23:
 * where to give fingerprints, the fastest Schengen embassy, the balance, why
 * not Japan from Jeddah) — the answer said as that text says it, or null when
 * the text does not say it. Never a fact from anywhere else.
 */
const PRICE_ASK = /(كم|بكم)\s*(ال)?(سعر|تكلف|كلف)|بكم\s*(ال)?(تا|تأ)شير|بكم\s*(ال)?فيز|كم\s*(ال)?سعر|السعر\s*كم/u;

export async function visaFaqAnswer(i: { faq: string; transcript: string; country: string | null; nationality: string | null }): Promise<string | null> {
  if (!i.faq.trim() || !isOpenAIConfigured()) return null;
  try {
    const raw = await openaiJson({
      name: "visa_faq",
      system: [
        "You answer for a travel company in Saudi Arabia on WhatsApp. Below is the company's own visa Q&A, then one visit of a client's conversation (oldest first, «العميل» = the client, «مُراد» = us).",
        "answer: reply to what the client's LATEST lines ask that the Q&A answers — only facts written in the Q&A, in its numbers and names, never anything else you know. A question about a country takes that country's section only («شنجن» covers the Schengen states); a section never answers a question that names neither it nor one of its states — «اسهل دولة» / «أسهل تأشيرة» alone is null, not the Schengen embassy. When the answer depends on whether the client is Saudi or a resident and that is not known, give both as the Q&A does.",
        "Give the Q&A's WHOLE answer — every figure, fee, period, condition and exception it states (the fingerprint fee, the six months the officer reads) — never a part of it. Short Saudi Arabic, one to four lines, no greeting, no question back. A «ملاحظة» line is an answer too, and so is an answer that says there is no fixed figure («غير مذكور رصيد معين…») — say it with the rest of what it says. null when the Q&A does not answer it, and ALWAYS null for the visa's price or cost («كم سعر», «بكم», «كم التكلفة») — the price list answers it; what a fee INCLUDES («وش تشمل الرسوم») and any one paper's details (the balance, a sponsor, where to give fingerprints) are the Q&A's.",
        "",
        "## أسئلة وأجوبة الشركة",
        i.faq.slice(0, 20000),
        "",
        `## ما نعرفه: الدولة: ${i.country ?? "غير معروفة"} · الجنسية: ${i.nationality ?? "غير معروفة"}`,
      ].join("\n"),
      user: withoutAd(i.transcript).slice(-3000),
      schema: { type: "object", properties: { answer: { type: ["string", "null"] } }, required: ["answer"], additionalProperties: false },
      temperature: 0,
      timeoutMs: 15000,
    });
    const a = (JSON.parse(raw ?? "{}") as { answer?: string | null }).answer?.trim();
    // the price is the list's, never the Q&A's fees («كم سعر تأشيرة فرنسا» got the office's 350 and Medina's 1100)
    const last = i.transcript.split("\n").filter((l) => l.startsWith("العميل")).at(-1) ?? "";
    if (PRICE_ASK.test(last) && !/تشمل|يشمل/u.test(last)) return null;
    // «أسهل تأشيرة» with no Europe or embassy in it is the list's advice (visa.ts), not «أسهل سفارة شنغن» (2026-10-23)
    if (ADVICE.test(last) && !/شنغن|شنجن|شينغن|[اأ]ور?وب|سفار/u.test(last)) return null;
    // the Q&A's own «ج:» is no part of the answer
    const clean = a?.replace(/^ج\s*:\s*/u, "").trim();
    return clean && clean !== "null" ? clean : null;
  } catch {
    return null;
  }
}
