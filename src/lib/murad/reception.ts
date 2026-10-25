/**
 * «المستقبل الآلي» (the owner, 2026-10-18) — Murad receives a new WhatsApp
 * conversation the moment it arrives: «وعليكم السلام، حياك الله محمد. أبشر،
 * سيتم تحويل طلبك إلى قسم التأشيرات الآن», and the conversation goes to that
 * department's Teletel team. Pure: what the client asked, what to say, where
 * it goes. The doing is reception-run.ts.
 *
 * Once a conversation: one greeting, at most one question («كيف نقدر نخدمك»)
 * when the first message names nothing, then the hand-over. Never over a
 * colleague who already answered, never outside WhatsApp's 24 hours, no
 * prices, no promises.
 */

import { classifyInquiry, type Place } from "@/lib/leads/auto";
import { inferConversationDestination } from "@/lib/leads/destination";
import { resolvePlace } from "@/lib/leads/places";
import { fold } from "@/lib/leads/sheet";
import { VISA_FREE_ASK } from "./visa";

/** where a request goes: the five services, a client asking for a person, and one we could not read */
export const ROUTE_KEYS = ["بكج", "تأشيرات", "طيران", "فنادق", "مواصلات", "موظف", "غير واضح"] as const;
export type RouteKey = (typeof ROUTE_KEYS)[number];

/** what the client is told — the department's name for them, not the team's name in Teletel */
export const DEPARTMENT: Record<RouteKey, string> = {
  بكج: "قسم البكجات السياحية",
  تأشيرات: "قسم التأشيرات",
  طيران: "قسم الطيران",
  فنادق: "قسم الفنادق",
  مواصلات: "قسم المواصلات",
  موظف: "أحد موظفينا",
  "غير واضح": "أحد موظفينا",
};

/** route key → Teletel team id; `fallback` takes what has no team of its own */
export type Routes = Partial<Record<RouteKey | "fallback", number | null>>;

export const CLARIFY_QUESTION = "حياك الله، كيف نقدر نخدمك: بكج، تأشيرة، طيران، أو فندق؟";

/** «ابي اكلم موظف» — written folded (no spaces, no hamza, ه for ة) */
const HUMAN = /(موظف|اكلم|كلمني|اتواصلمعشخص|شخصحقيقي|خدمهالعملاء|بشري|agent|human|realperson)/i;
export type Request = {
  kind: RouteKey | null;
  /** the country named, a city reported as its country («لندن» → بريطانيا) */
  country: string | null;
  wantsHuman: boolean;
  /** opened with السلام — answered with وعليكم السلام */
  salam: boolean;
};

/**
 * The ads' own words in a click-to-WhatsApp opening («مرحبا بكم في ترافليون ✈️| احجز بكجات سفر مع ترافليون انا مهتم
 * بـ تأشيرة أمريكا…»): the company's slogan is not the client's request — «بكجات» in it made every visa ad a package
 * (2026-10-23). What follows «انا مهتم بـ» stays.
 */
export const withoutAd = (text: string) =>
  text
    // whom the ad is for is no nationality: «تأشيرة أمريكا السياحية للسعوديين والمقيمين» (2026-10-23)
    .replace(/(مهتم بـ.*?)\s*لل(?:سعوديين|مقيمين)(?:\s*و\s*(?:ال|لل)(?:سعوديين|مقيمين))?/gu, "$1")
    .replace(/مرحبا بكم في ترافليون\s*✈️?\s*\|?|احجز بكجات سفر مع ترافليون|-?\s*ترافليون للسفر و\s*السياحة|\|\s*ترافليون\s*$/gmu, " ");

/** What one message asks for — the same rules «العملاء» classifies by (auto.ts), nothing guessed. */
export function readRequest(raw: string, places: Place[]): Request {
  const text = withoutAd(raw);
  const folded = fold(text);

  // the destination by the one rule (lib/leads/places.ts): a Saudi place is where the client is, never where they go
  const where = resolvePlace(text, places);
  const destination = inferConversationDestination([{ id: 1, at: 1, text, fromClient: true, isPrivate: false }], places).destination;
  const kind = classifyInquiry([], text, { destination: where.kind === "destination" ? destination : null });
  return {
    kind: kind === "رخص دولية" ? "موظف" : (ROUTE_KEYS as readonly string[]).includes(kind) ? (kind as RouteKey) : null,
    country: where.kind === "destination" ? where.country : null,
    wantsHuman: HUMAN.test(folded),
    salam: /سلام\s*عليكم/u.test(text),
  };
}

const KUNYA = /^(ابو|أبو|ام|أم)$/u;

/**
 * The first name to greet by, from the WhatsApp name — Arabic only: «أبو محمد»,
 * «رنا» from «Rana Graphic Designer | رنا مصممة جرافيك». A Latin or business
 * name («Enjoy your Life») greets without one rather than with a wrong one.
 */
export function firstName(contactName: string): string | null {
  const [first, second] = contactName.match(/[ء-ي]{2,}/gu) ?? [];
  if (!first) return null;
  return KUNYA.test(first) && second ? `${first} ${second}` : first;
}

/**
 * «تأخير بشري» (the owner, 2026-10-18: «ليس الرد بسرعة فائقة»): Murad answers
 * after a random 20–60 seconds, not in one; a second message in that wait
 * restarts the count once, never past 90 seconds from the first.
 */
export type Delay = { min: number; max: number };
export const DEFAULT_DELAY: Delay = { min: 25, max: 28 };
/** After Murad's first answer in a visit the client is mid-conversation: about ten seconds, the «يكتب…» pause included (the owner, 2026-10-22). */
export const FOLLOW_UP_DELAY: Delay = { min: 5, max: 7 };
export const MAX_WAIT_SEC = 90;

/** «20-60» → seconds, kept within 0–90 and min ≤ max; the default when it does not read. */
export function parseDelay(raw: string | null | undefined): Delay {
  const m = (raw ?? "").match(/^(\d{1,3})\s*-\s*(\d{1,3})$/);
  if (!m) return DEFAULT_DELAY;
  const min = Math.min(Number(m[1]), MAX_WAIT_SEC);
  const max = Math.min(Math.max(Number(m[2]), min), MAX_WAIT_SEC);
  return { min, max };
}

/** One wait, in seconds, somewhere in the range. */
export const pickDelay = (d: Delay, random = Math.random()) => d.min + Math.round(random * (d.max - d.min));

/** one opening window, Riyadh time; a close at or before the open runs past midnight (16:00-00:00, 18:00-02:00) */
export type Window = { open: string; close: string };
/** the week as windows per weekday, 0 = Sunday … 6 = Saturday (JS getDay) */
export type Week = Window[][];
/**
 * The office's working time. `open`/`close` are the legacy single window (kept for what only knows one); `week` is
 * set when the text names days and windows — «السبت-الخميس 10:30-12:30 16:00-00:00 | الجمعة 16:00-00:00».
 */
export type Hours = { open: string; close: string; week?: Week };

const SAT_FIRST = [6, 0, 1, 2, 3, 4, 5] as const;
const DAY_NAME = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;
const dayKey = (name: string) => name.replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/^ال/, "").trim();
const DAY_BY_KEY = new Map<string, number>(DAY_NAME.map((n, i) => [dayKey(n), i]));
const day = (name: string): number | null => DAY_BY_KEY.get(dayKey(name)) ?? null;
const hm = (h: string, m: string) => `${(Number(h) % 24).toString().padStart(2, "0")}:${m}`;
const WINDOW = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

/** the office's own sign (the owner, 2026-10-26): Saturday–Thursday 10:30–12:30 and 16:00–00:00, Friday 16:00–00:00 */
export const DEFAULT_WEEK: Week = [
  [{ open: "10:30", close: "12:30" }, { open: "16:00", close: "00:00" }], // Sun
  [{ open: "10:30", close: "12:30" }, { open: "16:00", close: "00:00" }], // Mon
  [{ open: "10:30", close: "12:30" }, { open: "16:00", close: "00:00" }], // Tue
  [{ open: "10:30", close: "12:30" }, { open: "16:00", close: "00:00" }], // Wed
  [{ open: "10:30", close: "12:30" }, { open: "16:00", close: "00:00" }], // Thu
  [{ open: "16:00", close: "00:00" }], // Fri
  [{ open: "10:30", close: "12:30" }, { open: "16:00", close: "00:00" }], // Sat
];
export const DEFAULT_HOURS: Hours = { open: "10:30", close: "12:30", week: DEFAULT_WEEK };

/**
 * «09:00-23:00» (every day) or «السبت-الخميس 10:30-12:30 16:00-00:00 | الجمعة 16:00-00:00» → the working time in
 * Riyadh; the office's own sign when it does not read.
 */
export function parseHours(raw: string | null | undefined): Hours {
  const text = (raw ?? "").trim();
  const legacy = text.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (legacy) return { open: hm(legacy[1], legacy[2]), close: hm(legacy[3], legacy[4]) };
  const week: Week = Array.from({ length: 7 }, () => []);
  let any = false;
  for (const group of text.split(/[|\n;]+/).map((g) => g.trim()).filter(Boolean)) {
    const tokens = group.split(/[\s،,]+/).filter(Boolean);
    const windows: Window[] = [];
    const words: string[] = [];
    for (const t of tokens) {
      const w = t.match(WINDOW);
      if (w) windows.push({ open: hm(w[1], w[2]), close: hm(w[3], w[4]) });
      else words.push(t);
    }
    if (!windows.length) continue;
    const days: number[] = [];
    for (const w of words) {
      const range = w.match(/^(.+?)-(.+)$/);
      if (range) {
        const a = day(range[1]);
        const b = day(range[2]);
        if (a === null || b === null) return DEFAULT_HOURS;
        for (let d = a; ; d = (d + 1) % 7) {
          days.push(d);
          if (d === b) break;
        }
      } else {
        const d = day(w);
        if (d === null) return DEFAULT_HOURS;
        days.push(d);
      }
    }
    for (const d of days.length ? days : [0, 1, 2, 3, 4, 5, 6]) {
      week[d] = windows.map((w) => ({ ...w }));
      any = true;
    }
  }
  if (!any) return DEFAULT_HOURS;
  for (const w of week) w.sort((a, b) => a.open.localeCompare(b.open));
  const first = week.find((w) => w.length)?.[0] ?? DEFAULT_HOURS;
  return { open: first.open, close: first.close, week };
}

/** the text the settings page shows and saves — days with equal windows grouped, the week from Saturday */
export function hoursText(h: Hours): string {
  const week = h.week;
  if (!week) return `${h.open}-${h.close}`;
  const key = (d: number) => week[d].map((w) => `${w.open}-${w.close}`).join(" ");
  if (SAT_FIRST.every((d) => key(d) === key(SAT_FIRST[0])) && week[SAT_FIRST[0]].length === 1) return key(SAT_FIRST[0]);
  const groups: { from: number; to: number; text: string }[] = [];
  for (const d of SAT_FIRST) {
    const text = key(d);
    if (!text) continue;
    const last = groups.at(-1);
    if (last && last.text === text && SAT_FIRST[SAT_FIRST.indexOf(last.to as (typeof SAT_FIRST)[number]) + 1] === d) last.to = d;
    else groups.push({ from: d, to: d, text });
  }
  return groups.map((g) => `${g.from === g.to ? DAY_NAME[g.from] : `${DAY_NAME[g.from]}-${DAY_NAME[g.to]}`} ${g.text}`).join(" | ");
}

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const;
function riyadh(now: Date): { dow: number; hm: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { dow: WEEKDAY[get("weekday") as keyof typeof WEEKDAY] ?? 0, hm: `${get("hour")}:${get("minute")}` };
}
/** the week the hours mean: its own, or the legacy single window every day */
const weekOf = (h: Hours): Week => h.week ?? Array.from({ length: 7 }, () => [{ open: h.open, close: h.close }]);

/** Inside the working time, Riyadh time (a window that closes at or before it opens runs on into the next day). */
export function isWorkingTime(now: Date, hours: Hours): boolean {
  const { dow, hm: at } = riyadh(now);
  const week = weekOf(hours);
  return week.some((windows, d) =>
    windows.some((w) => (w.open < w.close ? d === dow && at >= w.open && at < w.close : (d === dow && at >= w.open) || ((d + 1) % 7 === dow && at < w.close))),
  );
}

/** When the next window opens after now — «HH:MM» (a week ahead at most), null when the office never opens. */
export function nextOpening(now: Date, hours: Hours): string | null {
  const { dow, hm: at } = riyadh(now);
  const week = weekOf(hours);
  for (let k = 0; k <= 7; k++) {
    const starts = week[(dow + k) % 7].map((w) => w.open).filter((open) => k > 0 || open > at).sort();
    if (starts.length) return starts[0];
  }
  return null;
}

/** «9:00 صباحاً» */
export function sayTime(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const twelve = h % 12 || 12;
  return `${twelve}:${String(m).padStart(2, "0")} ${h < 12 ? "صباحاً" : "مساءً"}`;
}

/** The greeting and the hand-over, in one message. */
export function receptionText(i: { name: string | null; salam: boolean; to: RouteKey; opensAt: string | null }): string {
  const hello = i.salam ? "وعليكم السلام ورحمة الله وبركاته،" : "أهلاً وسهلاً،";
  const welcome = `حياك الله${i.name ? ` ${i.name}` : ""}.`;
  const move = i.to === "موظف" || i.to === "غير واضح" ? "أبشر، سيتم تحويلك إلى أحد موظفينا الآن." : `أبشر، سيتم تحويل طلبك إلى ${DEPARTMENT[i.to]} الآن.`;
  const later = i.opensAt ? ` وسيتواصل معك الموظف عند بداية الدوام الساعة ${sayTime(i.opensAt)}.` : "";
  return `${hello} ${welcome} ${move}${later}`;
}

/**
 * When the conversation was last closed before the client's message — Teletel's
 * own «تم تحديث حالة المحادثة لـ"مغلقة"» line, 0 when none is read. The visit
 * starts there: «العملاء»'s status is not a witness, the five-minute pull can
 * rewrite it between two messages (40029, 2026-10-19: Murad's Georgia question
 * fell out of the visit, and the client's answer met «كيف نقدر نخدمك؟»).
 */
export function lastClosedAt(events: { kind: string; at: number; text: string }[], before: number): number {
  return Math.max(0, ...events.filter((e) => e.kind === "activity" && /مغلق|resolved/u.test(e.text) && e.at <= before).map((e) => e.at));
}

/**
 * After the hand-over, the client wrote and no one answered in five minutes:
 * once a visit, that it arrived and who answers it (the evaluator, 2026-10-19:
 * «فنادق مكرره… الوووو… ليش التاخير» went unanswered). The colleague by first
 * name, their department, «خلال دقائق» — or the opening time out of hours.
 */
export function holdText(i: { assignee: string | null; team: string | null; opensAt: string | null }): string {
  const who = i.assignee?.trim().split(/\s+/)[0] || "زميلنا";
  const team = i.team?.trim();
  const from = team ? ` من ${team.startsWith("قسم") ? team : `قسم ${team}`}` : "";
  return `وصلت رسالتك، ${who}${from} سيرد عليك ${i.opensAt ? `عند بداية الدوام الساعة ${sayTime(i.opensAt)}` : "خلال دقائق"}.`;
}

/**
 * «ما هي الوجهات لديكم؟», «إيش الوجهات المتاحة», «وين تسافرون», «وش العروض اللي عندكم» — a client asking what we
 * sell, not naming a service (the owner's test, 2026-10-24: asked twice, handed over twice without an answer).
 * Read folded (no spaces, ا for أ, ه for ة); «وين بدون فيزا» is the visa list's question, not this one.
 */
const DESTINATIONS_ASK =
  /(الوجهات|وجهاتكم|وجهات(متاح|متوفر)|الوجهه(المتاح|المتوفر)|(لوين|وين)(تسافرون|توديون)|الدول(الي|اللي)(عندكم|تسافرون|توديون)|(العروض|البكجات|البرامج)(الموجوده|المتوفره|المتاحه|الحاليه|(اللي|الي)(?=عندكم|لديكم)|عندكم|لديكم)|(عروضكم|بكجاتكم)|(ايش|وش|شو)عندكم(من)?(عروض|بكجات|برامج|وجهات|دول)|^(السلامعليكم(ورحمهالله(وبركاته)?)?|مرحبا|هلا)?[،,.!]*(ايش|وش|شو)عندكم[؟?!.]*$)/u;
/** «بكجات بدون فيزا», «الوجهات اللي ما تحتاج تأشيرة» — the visa list's question, however it opens */
const VISA_FREE_WORDS = /(بدون|بلا|منغير|ماتحتاج|مايحتاج)(ال)?(فيز|تاشير)/u;

export function asksDestinations(text: string): boolean {
  const own = withoutAd(text);
  const folded = fold(own);
  return !VISA_FREE_ASK.test(own) && !VISA_FREE_WORDS.test(folded) && DESTINATIONS_ASK.test(folded);
}

/** Our countries, and the one question that moves the visit on — no prices, no promise of a country not listed. */
export function destinationsText(i: { countries: string[]; salam: boolean }): string {
  return [
    `${i.salam ? "وعليكم السلام ورحمة الله، " : ""}حياك الله، وجهاتنا الحالية في البكجات 🌍`,
    i.countries.join("، "),
    "وإذا في بالك وجهة ثانية قل لي.",
    "أي وجهة تناسبك؟ ومتى ناوي تسافر وكم شخص؟",
  ].join("\n");
}

/** The question when the first message names nothing — with the salam returned when it came with one. */
export function clarifyText(salam: boolean): string {
  return salam ? `وعليكم السلام ورحمة الله، ${CLARIFY_QUESTION}` : CLARIFY_QUESTION;
}

export type ReceptionDecision = { act: "none"; why: "routed" | "staff" | "assigned" | "window" } | { act: "ask" } | { act: "route"; to: RouteKey };

/**
 * The whole rule for one incoming message: nothing once the conversation was
 * handed over or a colleague answered or the 24 hours are shut; a person asked
 * for, or a service named → hand over; otherwise one question, and after it
 * whatever the answer is goes to the general team.
 */
export function decideReception(i: { routed: boolean; asked: boolean; staffReplied: boolean; handedByHand?: boolean; canReply: boolean; request: Request }): ReceptionDecision {
  if (i.routed) return { act: "none", why: "routed" };
  if (i.staffReplied) return { act: "none", why: "staff" };
  // someone took it in hand while Murad waited: theirs
  if (i.handedByHand) return { act: "none", why: "assigned" };
  if (!i.canReply) return { act: "none", why: "window" };
  if (i.request.wantsHuman) return { act: "route", to: "موظف" };
  if (i.request.kind) return { act: "route", to: i.request.kind };
  return i.asked ? { act: "route", to: "غير واضح" } : { act: "ask" };
}

/** A department's team: its own, else the fallback, else none (left unassigned, the page warns). */
export function teamFor(routes: Routes, to: RouteKey): number | null {
  return routes[to] ?? routes.fallback ?? null;
}

/**
 * A first table from the account's own teams, by their names — shown on the
 * settings page for the owner to correct; nothing is saved until they do. Two
 * kinds of request (the owner, 2026-10-22): a visa to «قسم فيزا», and EVERY
 * travel request — package, flight, hotel, transport — to «قسم المبيعات»
 * (never «متابعة المبيعات», the follow-up team); a person asked for or a
 * request not understood to «قسم الطلبات».
 */
export function suggestRoutes(teams: { id: number; name: string }[]): Routes {
  const find = (re: RegExp) => teams.find((t) => re.test(fold(t.name)))?.id ?? null;
  // «قسم الطلبات» first: «العلاقات العامه» also holds «عام», and Teletel listed it before (2026-10-24, team 40)
  const general = find(/طلبات/) ?? find(/استقبال/) ?? find(/^(?!.*علاقات).*عام/);
  const sales = find(/قسمالمبيعات|^المبيعات$|^مبيعات$/) ?? general;
  return {
    تأشيرات: find(/فيزا|تاشير/),
    بكج: sales,
    طيران: find(/طيران|تذاكر/) ?? sales,
    فنادق: find(/فنادق|فندق/) ?? sales,
    مواصلات: find(/مواصلات|نقل/) ?? sales,
    موظف: general,
    "غير واضح": general,
    fallback: general,
  };
}

/** The saved table (JSON), else the suggestion — every key read, nothing else kept. */
export function readRoutes(raw: string | null | undefined, teams: { id: number; name: string }[]): Routes {
  try {
    const saved = JSON.parse(raw ?? "") as Record<string, unknown>;
    if (!saved || typeof saved !== "object") throw new Error("none");
    const out: Routes = {};
    for (const k of [...ROUTE_KEYS, "fallback"] as const) {
      const v = saved[k];
      out[k] = typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    return out;
  } catch {
    return suggestRoutes(teams);
  }
}
