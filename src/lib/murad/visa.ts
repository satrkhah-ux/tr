import { fold } from "@/lib/leads/sheet";
import type { TurnMessage } from "./core";
import { withoutPrices } from "./price-visibility";

/**
 * Murad's visa flow — the OWNER'S DECISION (2026-10-22, relayed by the
 * evaluator): «ياخذ الطلب ويرسل السعر والشروط ويحوله الى قسم التأشيرات». A
 * short FIXED flow, never open Q&A (21 Oct: 62 real clients, repeats, an
 * invented fact). Per visit:
 *   1. the country, the nationality, the applicants — asked ONCE, only what is missing;
 *   2. ONE message: the list's price (per person × applicants when known) and
 *      its requirements VERBATIM — no number where the list has none (China,
 *      Morocco), nothing at all for a country not on the list;
 *   3. «قسم فيزا» takes it (visa-routing.ts), with a private note of what was heard;
 *   4. then silence for the rest of the visit.
 * Pure: what to ask and what to say. The doing is reception-run.ts.
 */

/** the Schengen states (ISO alpha-2) — «شنغن» alone names the ones the list prices */
export const SCHENGEN = new Set(["AT", "BE", "BG", "HR", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "IT", "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "CH"]);

export type VisaKind = "tourist" | "medical" | "study" | "work" | "family" | "other";

/** what the model read from the client's own lines (reception-run.ts readVisa) */
export type VisaAsk = {
  /** the country as our countries table spells it */
  country: string | null;
  kind: VisaKind | null;
  /** ISO 3166-1 alpha-3 («SAU») and how the client would say it («سعودي») */
  nationality: string | null;
  nationality_ar: string | null;
  applicants: number | null;
  /** approximate, YYYY-MM-DD */
  travel_date: string | null;
  refused_before: boolean | null;
  special: string | null;
  others?: { nationality: string; nationality_ar: string | null; resident: boolean | null }[];
  /** «شنغن» with no country named */
  schengen?: boolean | null;
  resident?: boolean | null;
  topics?: string[];
  status_query?: boolean | null;
  /** a trip asked for in the same breath — a sales request, not this flow */
  wants_trip?: boolean | null;
  /** «أسهل تأشيرة», «أي دولة» — no destination chosen, the client asks us to pick */
  advice?: "easiest" | "fastest" | "cheapest" | null;
  /** a visa INTO Saudi Arabia — not this flow's list */
  inbound?: boolean | null;
};

export type VisaRow = {
  country: string;
  visa_type: string | null;
  sell_price: number | null;
  sell_currency: string | null;
  arabic_requirements: string | null;
  status: string | null;
};

/** What the flow keeps of a request, in murad_log.intake.visa_flow — the private note and the follow-through read it. */
export type VisaFacts = {
  /** as the client's words named it — the list's spelling when it is on the list */
  country: string | null;
  /** «سعودي» */
  nationality: string | null;
  applicants: number | null;
  travelDate: string | null;
  /** «شنغن» alone */
  schengen?: boolean;
  /** not a tourist visa (work, study…) — the list prices tourist visas only */
  kind?: VisaKind | null;
  /** what the client asked that the list does not answer, and anything unusual — for the client's line and the note */
  topics?: string[];
  special?: string | null;
  refused?: boolean;
};

export type VisaNeed = "country" | "nationality" | "applicants";

const WORDS: Record<VisaNeed, string> = {
  country: "الدولة المطلوبة",
  nationality: "الجنسية",
  applicants: "عدد المتقدمين",
};

/** Step 1: what is missing of the three — asked once, whatever the answer the flow goes on. */
export function visaNeed(f: VisaFacts): VisaNeed[] {
  return (["country", "nationality", "applicants"] as const).filter((k) => !f[k]);
}

/** The one question — what is missing, the country named when known; «شنغن» alone names the ones the list prices. */
export function visaAskText(f: VisaFacts, need: VisaNeed[], schengen: string[] = []): string {
  const word = (n: VisaNeed) =>
    n === "country" && f.schengen ? `دولة الشنغن التي ستدخلها أولاً أو تقيم فيها أطول مدة${schengen.length ? ` (عندنا ${schengen.join(" و")})` : ""}` : WORDS[n];
  // «تعملون تأشيرات؟» is a question: answered before the asking (the owner's test, 2026-10-22)
  if (!f.country) return `أكيد نخدمك في التأشيرات، عشان أجهز لك التفاصيل: تكرماً ${need.map(word).join("، و")}؟`;
  return `حياك الله، عشان أجهز لك تفاصيل تأشيرة ${f.country}: تكرماً ${need.map(word).join("، و")}؟`;
}

/** A country off the list whose entry the catalogue marks visa-free for a Saudi passport («ماليزيا بدون تأشيرة للسعودي»). */
export function visaFreeText(country: string): string {
  return `الجواز السعودي ما يحتاج تأشيرة مسبقة لـ${country} 👍
وإذا تحب نجهز لك برنامج رحلة لها، قل لي وأحولك لزميلنا في البكجات.`;
}
export const isSaudi = (nationality: string | null) => Boolean(nationality && /سعود|saudi/i.test(nationality));

export const VISA_WHICH_COUNTRY = "عشان أعطيك السعر والمتطلبات: تكرماً اكتب الدولة اللي تبي تأشيرتها؟";
export const VISA_CLOSING = "سيتواصل معك زميلنا في قسم التأشيرات لإكمال الطلب.";

const KIND_WORDS: Record<VisaKind, string> = { tourist: "سياحية", medical: "علاجية", study: "دراسة", work: "عمل", family: "زيارة عائلية", other: "أخرى (عبور أو غيره)" };
/** what the list never answers — said back to the client so the question is seen, and in the note */
const TOPIC_WORDS: Record<string, string> = { time: "مدة الإصدار", appointment: "الموعد", fingerprints: "البصمة", validity: "مدة التأشيرة", refund: "الاسترداد عند الرفض", guarantee: "ضمان القبول" };
const openTopics = (f: VisaFacts) => [...new Set((f.topics ?? []).map((t) => TOPIC_WORDS[t]).filter(Boolean))].join(" و") || null;

const peopleText = (n: number) => (n === 1 ? "شخص واحد" : n === 2 ? "شخصين" : n <= 10 ? `${n} أشخاص` : `${n} شخصاً`);
const sar = (n: number) => `${n.toLocaleString("en-US")} ريال`;

/** The list's price per person — only a positive riyal figure; anything else is the colleague's to set. */
export function listPrice(row: VisaRow | null): number | null {
  return row && row.sell_currency === "SAR" && typeof row.sell_price === "number" && row.sell_price > 0 ? Math.ceil(row.sell_price) : null;
}

/** what the client was quoted, for the note: «400 ريال للشخص × شخصين = 800 ريال» */
export function quoteText(per: number, applicants: number | null): string {
  return `${sar(per)} للشخص${applicants && applicants > 1 ? ` × ${peopleText(applicants)} = ${sar(per * applicants)}` : ""}`;
}

/**
 * Steps 2 and 3 in the client's one message: the price and the requirements
 * as the list writes them — `row` null: a country not on the list, only the
 * hand-over line. `includePrice` off («إعدادات مُراد»): no figure anywhere.
 */
export function visaFlowText(i: { row: VisaRow | null; facts: VisaFacts; includePrice: boolean; salam: boolean; faq?: string | null }): string {
  const hello = i.salam ? "وعليكم السلام ورحمة الله، " : "";
  const asked = openTopics(i.facts);
  // the client's question answered from the company's visa Q&A (visa-read.ts visaFaqAnswer); else said back for the colleague
  const closing = i.faq ? `${i.faq}\n\n${VISA_CLOSING}` : asked ? `${VISA_CLOSING}\nوسؤالك عن ${asked} يجاوبك عليه زميلنا.` : VISA_CLOSING;
  if (!i.row) return `${hello}${closing}`;
  const per = listPrice(i.row);
  const requirements = (i.row.arabic_requirements ?? "").trim();
  const lines = [
    `${hello}تأشيرة ${i.row.country}${i.row.visa_type ? ` — ${i.row.visa_type}` : ""}`,
    ...(i.includePrice ? [per ? `💰 السعر: ${quoteText(per, i.facts.applicants)}` : "💰 السعر يحدده زميلنا."] : []),
    ...(i.includePrice && per && !i.facts.nationality ? ["(السعر حسب الجنسية)"] : []),
    ...(requirements ? ["", "📄 المتطلبات:", i.includePrice ? requirements : withoutPrices(requirements)] : []),
    "",
    closing,
  ];
  return lines.join("\n");
}

/** The private note for «قسم فيزا»: what was heard and what the client was told. */
export function visaFlowNote(i: { facts: VisaFacts; row: VisaRow | null; includePrice: boolean }): string {
  const per = listPrice(i.row);
  const quoted = !i.row ? "الدولة ليست في قائمة التأشيرات — لم يُرسل سعر ولا متطلبات" : !i.includePrice ? "أُرسلت المتطلبات بدون سعر (الأسعار مخفية في إعدادات مُراد)" : per ? quoteText(per, i.facts.applicants) : "لا سعر في القائمة — قيل للعميل «السعر يحدده زميلنا»";
  return [
    "🤖 مُراد — طلب تأشيرة",
    `الدولة: ${i.facts.country ?? "غير مذكورة"}`,
    `الجنسية: ${i.facts.nationality ?? "غير مذكورة"}`,
    `عدد المتقدمين: ${i.facts.applicants ?? "غير مذكور"}`,
    ...(i.facts.travelDate ? [`تاريخ السفر: ${i.facts.travelDate}`] : []),
    `السعر المرسل: ${quoted}`,
    ...(i.facts.kind && i.facts.kind !== "tourist" ? [`نوع التأشيرة: ${KIND_WORDS[i.facts.kind]} — ليست في قائمة الأسعار`] : []),
    ...(openTopics(i.facts) ? [`يسأل عن: ${openTopics(i.facts)}`] : []),
    ...(i.facts.refused ? ["⚠️ رُفضت له تأشيرة من قبل"] : []),
    ...(i.facts.special ? [`ملاحظة: ${i.facts.special}`] : []),
  ].join("\n");
}

/** The list's row for a country: the tourist visa first. */
export function visaRowFor(rows: (VisaRow & { country_id?: string | null })[], countryId: string | null, name: string | null): VisaRow | null {
  const list = rows.filter((r) => (r.status ?? "Active") === "Active" && ((countryId && r.country_id === countryId) || (name && fold(r.country) === fold(name))));
  return list.find((v) => v.visa_type?.includes("سياح")) ?? list[0] ?? null;
}

const firstLine = (text: string) => fold(text.split("\n")[0] ?? "").replace(/[^\p{L}\p{N}]+/gu, "");
/** The reply opens as one of Murad's earlier messages in this visit (21 Oct: the same line sent five times). */
export function repeatsMurad(reply: string, messages: TurnMessage[]): boolean {
  const head = firstLine(reply);
  return head.length > 0 && messages.some((m) => !m.fromClient && !m.isPrivate && firstLine(m.text) === head);
}

// ---------- what to do with a visa turn (reception-run.ts sends it) ----------

export type VisaCountry = { id: string; arabic_name: string; iso2: string | null; visa_required: boolean | null };
type ListRow = VisaRow & { country_id?: string | null };

export type VisaStep =
  /** the one question — or, for «أسهل تأشيرة», the advice that ends in it */
  | { do: "ask"; text: string; advice?: boolean }
  /** a Saudi party to a country the catalogue marks visa-free — no hand-over */
  | { do: "free"; country: string }
  /** the list's answer (row), or the hand-over line alone (null) — then «قسم فيزا» */
  | { do: "answer"; row: VisaRow | null };

const saudiParty = (f: VisaFacts, a: VisaAsk | null) => isSaudi(f.nationality) && !(a?.others ?? []).some((o) => o.nationality !== "SAU");
const isHome = (country: string | null) => Boolean(country && /سعودي|المملكة العربية/u.test(country));

/**
 * One visa turn (the owner's short flow, 2026-10-22, and the questions of 120
 * real visa conversations, 2026-10-23): a request already with the team, a
 * visa INTO Saudi Arabia — the team's at once; «أسهل تأشيرة» — the advice from
 * the list and the catalogue; else asked once; a Saudi party to a visa-free
 * country — said so, whether or not the list has a row (the UAE's 400 riyals
 * are a resident's); a non-tourist visa — the team's, never the tourist price;
 * else the list's answer.
 */
export function visaStep(i: { a: VisaAsk | null; facts: VisaFacts; asked: boolean; asks?: number; countries: VisaCountry[]; rows: ListRow[]; includePrice: boolean; schengen?: string[]; clientText?: string }): VisaStep {
  const { a, facts } = i;
  if (a?.status_query || a?.inbound || isHome(facts.country)) return { do: "answer", row: null };
  const need = visaNeed(facts);
  // how many times this visit asked already: «اسهل دولة» answering the first question still gets the advice (2026-10-23)
  const asks = i.asks ?? (i.asked ? 1 : 0);
  if (!facts.country && (a?.advice || (a && ADVICE.test(i.clientText ?? ""))) && !facts.schengen && asks < 2) return { do: "ask", advice: true, text: visaAdviceText({ facts, a, countries: i.countries, rows: i.rows, includePrice: i.includePrice }) };
  const country = i.countries.find((c) => facts.country && fold(c.arabic_name) === fold(facts.country));
  // a Saudi party to a visa-free country needs no count first
  if (country?.visa_required === false && saudiParty(facts, a)) return { do: "free", country: country.arabic_name };
  if (need.length && asks === 0) return { do: "ask", text: visaAskText(facts, need, i.schengen) };
  // still no country after the question and the client still writing («كم السعر؟»): the country alone, once more —
  // never handed over blind (2026-10-23). The unanswered follow-through (a null) hands over.
  if (!facts.country && asks >= 1 && asks < 3 && a) return { do: "ask", text: facts.schengen ? visaAskText(facts, ["country"], i.schengen) : VISA_WHICH_COUNTRY };
  if (facts.kind && facts.kind !== "tourist") return { do: "answer", row: null };
  return { do: "answer", row: visaRowFor(i.rows, country?.id ?? null, facts.country) };
}

/** papers that make a visa heavy — a row whose requirements name none of them is «الأقل متطلبات» */
const HEAVY = /كشف\s*حساب|تعريف|خطاب|الجواز\s*الا?صل|حضور|تبصيم|بصم|شهاد/u;

/**
 * «أسهل تأشيرة؟» (the owner, 2026-10-23: «يبحث عن الشروط الأقل»): from the list
 * and the catalogue only — a Saudi passport's visa-free countries first; then
 * the list's countries whose requirements name no bank statement, salary
 * letter, original passport or attendance («أرخص»: the list's prices, low to
 * high). Never an acceptance rate. Ends in the one question.
 */
export function visaAdviceText(i: { facts: VisaFacts; a: VisaAsk | null; countries: VisaCountry[]; rows: ListRow[]; includePrice: boolean }): string {
  const saudi = saudiParty(i.facts, i.a);
  const byId = new Map(i.countries.map((c) => [c.id, c]));
  // a Saudi needs only the list's rows for countries that ask him for a visa
  const rows = i.rows.filter((r) => (r.status ?? "Active") === "Active" && !(saudi && byId.get(r.country_id ?? "")?.visa_required === false));
  const lines: string[] = [];
  if (saudi) {
    const free = i.countries.filter((c) => c.visa_required === false && !isHome(c.arabic_name)).map((c) => c.arabic_name);
    if (free.length) lines.push(`الجواز السعودي ما يحتاج تأشيرة مسبقة لدول كثيرة، منها: ${free.slice(0, 12).join("، ")}${free.length > 12 ? " وغيرها" : ""} 👍`);
  }
  const cheap = i.a?.advice === "cheapest" && i.includePrice;
  const pick = cheap
    ? rows.filter((r) => listPrice(r)).sort((x, y) => listPrice(x)! - listPrice(y)!).slice(0, 4).map((r) => `${r.country} ${sar(listPrice(r)!)}`)
    : [...new Set(rows.filter((r) => !HEAVY.test(r.arabic_requirements ?? "")).map((r) => r.country))].slice(0, 5);
  const lead = saudi ? (cheap ? "ومن التأشيرات، " : "ومن الدول اللي تحتاج تأشيرة، ") : "";
  if (pick.length) lines.push(cheap ? `${lead}الأقل سعراً عندنا: ${pick.join("، ")}.` : `${lead}الأقل متطلبات عندنا: ${pick.join("، ")} — بدون كشف حساب ولا تعريف راتب ولا حضور للسفارة.`);
  if (!saudi) lines.push("والمتطلبات تختلف حسب الجنسية.");
  const need = visaNeed(i.facts).filter((n) => n !== "country");
  lines.push(`أي دولة تفضّل؟${need.length ? ` وتكرماً ${need.map((n) => WORDS[n]).join("، و")}؟` : ""}`);
  return lines.join("\n");
}

/** «أي دولة أسافر لها بدون فيزا؟» — a visa question though «بدون فيزا» reads as a service NOT wanted (auto.ts) */
export const VISA_FREE_ASK = /(دول[ةه]|دول|بلد|وين|[اأ]ين).{0,30}(بدون|بلا|ما تحتاج|ماتحتاج|من غير|ما يحتاج) ?(ال)?(فيز|تاشير|تأشير)/u;
const TRANSIT = /عبور|ترانزيت|ترانسيت|transit/iu;
const GENERIC = new Set(["المملكة", "المتحدة", "العربية", "الولايات", "جمهورية", "الشعبية", "الجنوبية", "الشمالية"]);
/** «أسهل تأشيرة», «اي دولة مش شرط», «بدون كشف حساب» — the model's advice missed it (2026-10-23) */
export const ADVICE = /[اأ]سهل|[اأ]رخص|[اأ]سرع|نسب[ةه] ?القبول|[اأ]قل (شروط|متطلبات)|شروط(ها)? (قليل|[اأ]قل)|(ما تحتاج|بدون|بلا|من غير) (كشف|تعريف|حضور)|[اأ]ي (دول[ةه]|مكان|بلد)/u;

/** spelling-blind: «فتنام» is «فيتنام», «قركزستان» is «قيرغيزستان» */
export const loose = (t: string) => fold(t).replace(/[اأإآىيوءئؤةه\s]/gu, "").replace(/[قغ]/gu, "ك");

/**
 * What is known after this turn: the model's reading over what the one
 * question already gathered. A country the client never wrote is the model's
 * guess («أسهل تأشيرة لأي دولة» became ماليزيا, 2026-10-22) — dropped; `said`
 * is the plain reader's country (reception.ts readRequest) for the same lines.
 */
export function visaFacts(i: { a: VisaAsk | null; clientText: string; said: string | null; before: VisaFacts | null; countries: { arabic_name: string }[] }): VisaFacts {
  const { a, before } = i;
  // a name is written when one of its own words is («الامارات» for الإمارات العربية المتحدة); an English message is trusted
  const words = (c: string) => c.split(/\s+/u).filter((w) => w.length >= 4 && !GENERIC.has(w));
  const written = (c: string) => Boolean(i.said) || !/\p{Script=Arabic}/u.test(i.clientText) || [c, ...words(c)].some((w) => loose(i.clientText).includes(loose(w)));
  // «أيها أسهل: اليونان، إيطاليا، إسبانيا؟» — a comparison names no one destination
  const comparing = Boolean(a?.advice && !a.country);
  const picked = comparing ? null : ((a?.country && written(a.country) ? a.country : null) ?? i.said ?? before?.country ?? null);
  // «شنغن (أوروبا)» is the places' name for the area, not a country: the one question asks which state
  const area = Boolean(picked && /شنغن|شينغن|[اأ]وروبا/u.test(picked));
  const named = area ? null : picked;
  const topics = [...new Set([...(before?.topics ?? []), ...(a?.topics ?? [])])];
  return {
    country: (named && i.countries.find((c) => fold(c.arabic_name) === fold(named))?.arabic_name) ?? named,
    nationality: a?.nationality_ar ?? before?.nationality ?? null,
    applicants: a?.applicants ?? before?.applicants ?? null,
    travelDate: a?.travel_date ?? before?.travelDate ?? null,
    ...((a?.schengen && !a.country) || area ? { schengen: true } : {}),
    // a transit visa is never the list's tourist one, whatever country the model settled on
    ...(TRANSIT.test(i.clientText) ? { kind: "other" as const } : (a?.kind ?? before?.kind) ? { kind: a?.kind ?? before?.kind } : {}),
    ...(topics.length ? { topics } : {}),
    ...((a?.special ?? before?.special) ? { special: a?.special ?? before?.special } : {}),
    ...(a?.refused_before || before?.refused ? { refused: true } : {}),
  };
}
