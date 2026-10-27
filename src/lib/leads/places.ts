import { fold } from "./sheet";
import type { Place } from "./auto";
import { mentionsPlace } from "./place-match";

/**
 * «ما الوجهة؟» — one place decides it (the owner, 2026-10-19: «الدول الأكثر
 * طلباً» was counting جدة and المدينة as destinations). A conversation's free
 * text («اسطنبول», «بالي», «يلوا», «السعوديه») resolves to:
 *  · a destination: its country, and its city when the text names one
 *    (يلوا → تركيا / يلوا; بالي → اندونيسيا / بالي);
 *  · an origin: a Saudi place — where the client is, which is what the
 *    «المدينة» Google campaigns target — never a destination;
 *  · nothing: unresolved, or «لم يحدد طلب».
 * Matched against the catalogue (countries + cities) and a few spellings it
 * lacks; the longest name wins («الشمال التركي» over «تركيا»).
 */
export type Resolved = { kind: "destination"; country: string; city: string | null } | { kind: "origin"; place: string } | { kind: "none" };

/** spellings the catalogue lacks: folded text → [country, city] */
export const PLACE_ALIASES: [string, string, string | null][] = [
  ["يلوا", "تركيا", "يلوا"],
  ["يالوفا", "تركيا", "يلوا"],
  ["بولو", "تركيا", "بولو"],
  ["صبنجه", "تركيا", "صبنجة"],
  ["سبانجا", "تركيا", "صبنجة"],
  ["سابا", "فيتنام", "سابا"],
  ["بونشاك", "اندونيسيا", "بونشاك"],
  ["بالي", "اندونيسيا", "بالي"],
  ["بريطانيا", "المملكة المتحدة", null],
  ["لندن", "المملكة المتحدة", "لندن"],
  ["امريكا", "الولايات المتحدة", null],
  ["تايلند", "تايلاند", null],
  ["الشمال التركي", "تركيا", "الشمال التركي"],
  ["الخرطوم", "السودان", "الخرطوم"],
  ["بورت سودان", "السودان", "بورتسودان"],
  ["بورتسودان", "السودان", "بورتسودان"],
  ["ايدر", "تركيا", "آيدر"],
  ["اوزنجول", "تركيا", "أوزنجول"],
  ["استنطبول", "تركيا", "اسطنبول"],
  ["بوكت", "تايلاند", "بوكيت"],
  ["بوكيت", "تايلاند", "بوكيت"],
  ["مكه", "السعودية", "مكة"],
  ["فوكو", "فيتنام", "فوكوك"],
  ["شنغن", "شنغن (أوروبا)", null],
  ["شينغن", "شنغن (أوروبا)", null],
  // a European campaign and a «شنغن» conversation are one destination (the walk of f3bfccf)
  ["اوروبا", "شنغن (أوروبا)", null],
  ["اوربا", "شنغن (أوروبا)", null],
  ["البوسنه", "البوسنة والهرسك", null],
];

const NOTHING = /^(لم يحدد|غير محدد|لا يوجد|-|—)/u;
// Saudi places in the short forms clients write («مكة», «المدينة») — the catalogue holds them in full
const SAUDI_WORDS = /السعودي|^المملكه$|المملكهالعربيه|^داخلي$|^مكه|^المدينه$|^المدينهالمنوره/u;

const strip = (s: string) => fold(s).replace(/^ال/, "");

export function resolvePlace(text: string | null | undefined, places: Place[]): Resolved {
  const raw = (text ?? "").trim();
  if (!raw || NOTHING.test(raw)) return { kind: "none" };
  const f = fold(raw);
  const isSaudi = (country: string) => SAUDI_WORDS.test(fold(country));
  // every place the text holds — the catalogue's, and the spellings it lacks — the longest first
  type Hit = { name: string; country: string; city: string | null; len: number };
  const hits: Hit[] = [
    ...places
      .filter((p) => fold(p.name).length >= 3 && (mentionsPlace(raw, p.name) || strip(p.name) === strip(raw)))
      .map((p) => {
        const country = p.country || p.name;
        return { name: p.name, country, city: strip(p.name) === strip(country) ? null : p.name, len: fold(p.name).length };
      }),
    ...PLACE_ALIASES.filter(([k]) => mentionsPlace(raw, k)).map(([k, country, city]) => ({ name: city ?? country, country, city, len: fold(k).length })),
  ].sort((x, y) => y.len - x.len);
  // a destination wins over where the client is: «انا من السعودية وابي لندن» asks for London
  const dest = hits.find((h) => !isSaudi(h.country));
  if (dest) return { kind: "destination", country: dest.country, city: dest.city };
  const saudi = hits[0];
  if (saudi || SAUDI_WORDS.test(f)) return { kind: "origin", place: saudi?.name ?? raw };
  return { kind: "none" };
}

/**
 * The destination a Google campaign sells, by the same rule («003 بحث ماليزيا 🟩 كامل» →
 * ماليزيا): a campaign aimed at a Saudi city («بحث عام … المدينة») sells no destination — «عام» —
 * and the visa ones are «تأشيرات» unless they name a country.
 */
export function campaignDestination(name: string, places: Place[]): string {
  const r = resolvePlace(name, places);
  if (r.kind === "destination") return r.country;
  return /فيزا|تاشير|تأشير|visa/iu.test(name) ? "تأشيرات" : "عام";
}
