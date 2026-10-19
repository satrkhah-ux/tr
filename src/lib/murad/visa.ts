/**
 * Murad as a visa clerk (the owner, 2026-10-19: «كأن مراد موظف تأشيرات لأي
 * عميل يطلب التأشيرة لأي دولة»). Pure: what is still to ask, whether the
 * passport needs a visa at all, and the answer from the company's visa list
 * (public.visas) — the price per person times the applicants, the notes the
 * list keeps beside its price (embassy fees, urgent, multiple entry), the
 * documents numbered. Never a promise: «القبول قرار السفارة». The doing is
 * reception-run.ts.
 */

/** the Schengen states (ISO alpha-2) — «شنغن» alone names the ones the list prices */
export const SCHENGEN = new Set(["AT", "BE", "BG", "HR", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "IT", "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "CH"]);

export type VisaKind = "tourist" | "medical" | "study" | "work" | "family" | "other";

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
  /** the other applicants whose passport differs from the writer's («وصديق لي سعودي») */
  others?: { nationality: string; nationality_ar: string | null; resident: boolean | null }[];
  /** «شنغن» with no country named — asked which they enter first or stay in longest */
  schengen?: boolean | null;
  /** lives in Saudi Arabia (an «إقامة») — the list's documents are written for residents and Saudis */
  resident?: boolean | null;
  /** what the client asked about, beyond applying */
  topics?: VisaTopic[];
  /** «وين وصلت تأشيرتي؟» — a request already with the visa team */
  status_query?: boolean | null;
  /** a trip asked for in the same breath («بكج جورجيا… وهل احتاج تأشيرة؟») */
  wants_trip?: boolean | null;
};

export type VisaTopic = "requirements" | "price" | "time" | "appointment" | "fingerprints" | "validity" | "refund" | "guarantee";

export type VisaRow = {
  country: string;
  visa_type: string | null;
  sell_price: number | null;
  sell_currency: string | null;
  arabic_requirements: string | null;
  status: string | null;
};

export type VisaNeed = "country" | "nationality" | "residence" | "applicants" | "travel_date";

/** What is still missing before an answer — the travel date is asked once, never required. */
export function visaMissing(a: VisaAsk, askedBefore: boolean): VisaNeed[] {
  const out: VisaNeed[] = [];
  if (!a.country) out.push("country");
  if (!a.nationality) out.push("nationality");
  // never assume a Saudi: another passport is asked whether it lives here — the list's documents are a resident's
  else if (a.nationality !== "SAU" && a.resident == null) out.push("residence");
  if (!a.applicants) out.push("applicants");
  if (!a.travel_date && !askedBefore) out.push("travel_date");
  return out;
}

const WORDS: Record<VisaNeed, string> = {
  country: "الدولة المطلوبة",
  nationality: "الجنسية",
  residence: "هل أنت مقيم في السعودية",
  applicants: "عدد المتقدمين",
  travel_date: "تاريخ السفر التقريبي",
};

/** «شنغن» alone: the country they enter first or stay in longest decides the embassy — the ones we price named. */
const schengenWord = (ours: string[]) => `دولة الشنغن التي ستدخلها أولاً أو تقيم فيها أطول مدة${ours.length ? ` (عندنا ${ours.join(" و")})` : ""}`;

/** The one question — what is missing, the country named when known. */
export function visaAskText(country: string | null, need: VisaNeed[], first: boolean, schengen: string[] | null = null): string {
  const list = need.map((n) => (n === "country" && schengen ? schengenWord(schengen) : WORDS[n])).join("، و");
  return first
    ? `حياك الله، عشان أجهز لك تفاصيل ${country ? `تأشيرة ${country}` : "التأشيرة"}: تكرماً ${list}؟`
    : `شكراً لك، باقي فقط: ${list}؟`;
}

export type VisaStep = { act: "ask"; need: VisaNeed[] } | { act: "info"; need: VisaNeed[] } | { act: "not_needed" } | { act: "handoff"; reason: string } | { act: "answer" };

/**
 * The next thing to do, in the order a clerk would — never a question whose
 * answer changes nothing: a study visa, a refusal before, a country the list
 * does not price go to the visa team at once; a passport that needs no visa
 * is told so before the party is asked; the party and the date only before
 * an answer with a price. Two questions at most, then a colleague.
 *
 * `known`: the country is in our countries table; `required`: its
 * visa_required (written for Saudi passports); `status`: visaFor() with the
 * nationality said; `row`: its active visa in the list.
 */
export function visaStep(a: VisaAsk, c: { known: boolean; required: boolean | null; status: string; row: VisaRow | null; asks: number }): VisaStep {
  const askOr = (need: VisaNeed[], reason: string): VisaStep => (need.length && c.asks < 2 ? { act: "ask", need } : { act: "handoff", reason });
  if (a.status_query) return { act: "handoff", reason: "متابعة طلب قائم" };
  if (!a.country) return askOr(visaMissing(a, c.asks > 0), "الدولة غير واضحة");
  if (!c.known) return { act: "handoff", reason: "تأشيرة هذه الدولة يجهزها زميلنا مباشرة" };
  const unusual = visaHandoffReason({ ...a, special: a.special }, { country: a.country, visa_type: null, sell_price: 1, sell_currency: "SAR", arabic_requirements: null, status: "Active" }, c.status);
  if (unusual) return { act: "handoff", reason: unusual };
  // a country our list does not price and that Saudi passports need a visa for: nothing to ask that changes it
  if (!c.row && c.required !== false) return { act: "handoff", reason: "تأشيرة هذه الدولة يجهزها زميلنا مباشرة" };
  // «وش المطلوب لتأشيرة فرنسا؟»: the list answers it now, and asks what starting a request needs
  const priced = Boolean(c.row && (c.row.status ?? "Active") === "Active" && (c.row.sell_price ?? 0) > 0);
  const missingNow = visaMissing(a, c.asks > 0);
  if (priced && (a.topics?.length ?? 0) > 0 && missingNow.length && c.asks < 2 && c.status !== "not_required") return { act: "info", need: missingNow };
  if (!a.nationality) return askOr(missingNow, "الجنسية غير معروفة");
  if (c.status === "not_required") return { act: "not_needed" };
  const listed = visaHandoffReason(a, c.row, c.status);
  if (listed) return { act: "handoff", reason: listed };
  const need = visaMissing(a, c.asks > 0);
  return need.length ? askOr(need, "بيانات ناقصة") : { act: "answer" };
}

/** Why Murad hands it to the visa team rather than answering — null when he answers. */
export function visaHandoffReason(a: VisaAsk, row: VisaRow | null, need: string): string | null {
  if (a.kind && a.kind !== "tourist") return { medical: "تأشيرة علاجية", study: "تأشيرة دراسة", work: "تأشيرة عمل", family: "تأشيرة عائلية", other: "نوع تأشيرة خاص" }[a.kind];
  if (a.refused_before) return "رفض سابق";
  if (a.special) return a.special;
  if (!row || (row.status ?? "Active") !== "Active") return "تأشيرة هذه الدولة يجهزها زميلنا مباشرة";
  // never a price of 0 to a client (الصين، المغرب): the colleague sets it after looking at the request
  if (row.sell_price == null || row.sell_price <= 0) return need === "check" ? "السعر حسب الجنسية، يحدده زميلنا بعد مراجعة الطلب" : "السعر يحدده زميلنا بعد مراجعة الطلب";
  return null;
}

// a price said in words, or a sum in riyals — not a bank balance («رصيد لا يقل عن 10 الاف ريال» is a document)
const PRICE_WORD = /السعر|سعر|رسوم|التكلف|تكلف|مستعجل|متعدد|مفرد/u;
const RIYALS = /[\d١-٩]+\s*ريال/u;
const BALANCE = /رصيد|كشف/u;
// how long it takes, and whether the client must attend — not a validity («صالح لمده 6 شهور» is a document)
const TIME_LINE = /وقت|الانجاز|الإنجاز|الاصدار|الإصدار|خلال|تاخذ|تأخذ|ياخذ|يأخذ|يوم عمل|ايام عمل|أيام عمل|ساع[ةه]|الحضور/u;

/**
 * The list's text, as written for staff, split for a client: the price notes
 * and the processing time apart, the documents numbered afresh — the text's
 * own «1-» numbering and a heading that only repeats the country left out.
 */
export function splitRequirements(text: string | null, country: string): { docs: string[]; notes: string[] } {
  const docs: string[] = [];
  const notes: string[] = [];
  const name = country.replace(/\s+/g, "");
  for (const raw of (text ?? "").split(/\r?\n+/)) {
    const line = raw.replace(/^\s*[\d١-٩]+\s*[-.)]\s*/u, "").replace(/\s+/g, " ").trim();
    if (!line || line.replace(/\s+/g, "") === name || line === "السعر") continue;
    const price = PRICE_WORD.test(line) || (RIYALS.test(line) && !BALANCE.test(line));
    (price || TIME_LINE.test(line) ? notes : docs).push(line);
  }
  return { docs, notes };
}

const TOPIC: Record<VisaTopic, { label: string; covered: (text: string) => boolean }> = {
  requirements: { label: "المتطلبات", covered: () => true },
  price: { label: "السعر", covered: () => true },
  time: { label: "مدة الإصدار", covered: (t) => TIME_LINE.test(t) },
  appointment: { label: "الموعد والمقابلة", covered: (t) => /موعد|مقابل/u.test(t) },
  fingerprints: { label: "البصمة", covered: (t) => /بصم|تبصيم/u.test(t) },
  validity: { label: "مدة صلاحية التأشيرة", covered: () => false },
  refund: { label: "استرداد المبلغ عند الرفض", covered: () => false },
  // never a guarantee: «القبول قرار السفارة، ولا يوجد ضمان للقبول» answers it on every reply
  guarantee: { label: "ضمان القبول", covered: () => true },
};

/** What the client asked that the list does not say — the colleague answers it, Murad never does. */
export function uncoveredTopics(topics: VisaTopic[] | undefined, text: string | null): string[] {
  return (topics ?? []).filter((t) => TOPIC[t] && !TOPIC[t].covered(text ?? "")).map((t) => TOPIC[t].label);
}

const peopleText = (n: number) => (n === 1 ? "شخص واحد" : n === 2 ? "شخصين" : n <= 10 ? `${n} أشخاص` : `${n} شخصاً`);

/** The answer: the price for the party, what the list says about it, the documents — and the embassy decides. */
export function visaAnswerText(i: { country: string; row: VisaRow; applicants: number | null; sarPer: number; check: boolean; topics?: VisaTopic[]; need?: VisaNeed[] }): string {
  const per = Math.ceil((i.row.sell_price ?? 0) * i.sarPer);
  const { docs, notes } = splitRequirements(i.row.arabic_requirements, i.country);
  const n = i.applicants ?? 0;
  const open = uncoveredTopics(i.topics, i.row.arabic_requirements);
  const lines = [
    `تأشيرة ${i.country} ${i.row.visa_type?.includes("سياح") || !i.row.visa_type ? "السياحية" : `(${i.row.visa_type})`}:`,
    `💰 السعر: ${per.toLocaleString("en-US")} ريال للشخص${n > 1 ? ` × ${peopleText(n)} = ${(per * n).toLocaleString("en-US")} ريال` : ""}`,
    ...notes.map((x) => `• ${x}`),
    ...(docs.length ? ["", "📄 المطلوب لكل متقدم:", ...docs.map((d, k) => `${k + 1}- ${d}`)] : []),
    "",
    ...(open.length ? [`بخصوص ${open.join(" و")}: يؤكدها لك زميلنا في قسم التأشيرات.`] : []),
    i.check ? "المتطلبات والسعر قد تختلف حسب الجنسية، ويؤكدها زميلنا في قسم التأشيرات." : "السعر يؤكده زميلنا في قسم التأشيرات.",
    "القبول قرار السفارة، ولا يوجد ضمان للقبول.",
    i.need?.length ? `وللبدء بطلبك تكرماً: ${i.need.map((x) => WORDS[x]).join("، و")}؟` : "أرسل المستندات هنا ويكمل معك زميلنا.",
  ];
  return lines.join("\n");
}

/** A passport that needs no visa there: said plainly, no visa sold — and a package offered instead. */
export function notNeededText(country: string, nationalityAr: string | null): string {
  return `حامل الجواز ${nationalityAr ? `ال${nationalityAr.replace(/^ال/, "")}` : "الخاص بك"} لا يحتاج تأشيرة مسبقة لدخول ${country}. وإذا تحب نجهز لك برنامج سياحي لـ${country}، أرسل لي عدد الأيام وعدد الأشخاص.`;
}

/** «بريطانيا، سياحية، سعودي، شخصين، السفر 1/12» — what was understood, for the client and the note. */
export function visaSummary(a: VisaAsk): string {
  const [, m, d] = a.travel_date?.split("-").map(Number) ?? [];
  const kind = { tourist: "سياحية", medical: "علاجية", study: "دراسة", work: "عمل", family: "عائلية", other: "نوع خاص" };
  const who = (ar: string | null, code: string | null, resident: boolean | null | undefined) => (ar ? `${ar}${code && code !== "SAU" && resident ? " مقيم" : ""}` : null);
  const passports = [who(a.nationality_ar, a.nationality, a.resident), ...(a.others ?? []).map((o) => who(o.nationality_ar, o.nationality, o.resident))].filter(Boolean).join(" + ") || null;
  return [a.country, a.kind ? kind[a.kind] : "سياحية", passports, a.applicants ? peopleText(a.applicants) : null, d && m ? `السفر ${d}/${m}` : null]
    .filter(Boolean)
    .join("، ");
}

/** A hand-over in plain words: why, and what was heard — never a general question. */
export function visaHandoffText(reason: string, summary: string, opensAt: string | null): string {
  return `طلبك يحتاج زميلنا في قسم التأشيرات (${reason})، وحوّلته له الآن. سجّلت: ${summary}.${opensAt ? ` ويتواصل معك عند بداية الدوام الساعة ${opensAt}.` : ""}`;
}
