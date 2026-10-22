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
  return `حياك الله، عشان أجهز لك تفاصيل ${f.country ? `تأشيرة ${f.country}` : "التأشيرة"}: تكرماً ${need.map(word).join("، و")}؟`;
}

export const VISA_CLOSING = "سيتواصل معك زميلنا في قسم التأشيرات لإكمال الطلب.";

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
export function visaFlowText(i: { row: VisaRow | null; facts: VisaFacts; includePrice: boolean; salam: boolean }): string {
  const hello = i.salam ? "وعليكم السلام ورحمة الله، " : "";
  if (!i.row) return `${hello}${VISA_CLOSING}`;
  const per = listPrice(i.row);
  const requirements = (i.row.arabic_requirements ?? "").trim();
  const lines = [
    `${hello}تأشيرة ${i.row.country}${i.row.visa_type ? ` — ${i.row.visa_type}` : ""}`,
    ...(i.includePrice ? [per ? `💰 السعر: ${quoteText(per, i.facts.applicants)}` : "💰 السعر يحدده زميلنا."] : []),
    ...(i.includePrice && per && !i.facts.nationality ? ["(السعر حسب الجنسية)"] : []),
    ...(requirements ? ["", "📄 المتطلبات:", i.includePrice ? requirements : withoutPrices(requirements)] : []),
    "",
    VISA_CLOSING,
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
