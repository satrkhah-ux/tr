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

import { classifyInquiry, findPlace, type Place } from "@/lib/leads/auto";
import { fold } from "@/lib/leads/sheet";

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

/** What one message asks for — the same rules «العملاء» classifies by (auto.ts), nothing guessed. */
export function readRequest(text: string, places: Place[]): Request {
  const folded = fold(text);
  const kind = classifyInquiry([], text);
  const place = findPlace([], text, places);
  const hit = place ? places.find((p) => p.name === place) : undefined;
  return {
    kind: (ROUTE_KEYS as readonly string[]).includes(kind) ? (kind as RouteKey) : null,
    country: hit ? hit.country || hit.name : place || null,
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

export type Hours = { open: string; close: string };
export const DEFAULT_HOURS: Hours = { open: "09:00", close: "23:00" };

/** «09:00-23:00» → the working day in Riyadh time; the default when it does not read. */
export function parseHours(raw: string | null | undefined): Hours {
  const m = (raw ?? "").match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return DEFAULT_HOURS;
  const t = (h: string, mm: string) => `${h.padStart(2, "0")}:${mm}`;
  return { open: t(m[1], m[2]), close: t(m[3], m[4]) };
}

/** Inside the working day, Riyadh time (a day past midnight, «18:00-02:00», wraps). */
export function isWorkingTime(now: Date, hours: Hours): boolean {
  const hm = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return hours.open <= hours.close ? hm >= hours.open && hm < hours.close : hm >= hours.open || hm < hours.close;
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

/** The question when the first message names nothing — with the salam returned when it came with one. */
export function clarifyText(salam: boolean): string {
  return salam ? `وعليكم السلام ورحمة الله، ${CLARIFY_QUESTION}` : CLARIFY_QUESTION;
}

export type ReceptionDecision = { act: "none"; why: "routed" | "staff" | "window" } | { act: "ask" } | { act: "route"; to: RouteKey };

/**
 * The whole rule for one incoming message: nothing once the conversation was
 * handed over or a colleague answered or the 24 hours are shut; a person asked
 * for, or a service named → hand over; otherwise one question, and after it
 * whatever the answer is goes to the general team.
 */
export function decideReception(i: { routed: boolean; asked: boolean; staffReplied: boolean; canReply: boolean; request: Request }): ReceptionDecision {
  if (i.routed) return { act: "none", why: "routed" };
  if (i.staffReplied) return { act: "none", why: "staff" };
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
 * A first table from the account's own teams, by their names («قسم فيزا» for
 * visas, «قسم المبيعات» for packages, «قسم الطلبات» for the rest) — shown on
 * the settings page for the owner to correct; nothing is saved until they do.
 */
export function suggestRoutes(teams: { id: number; name: string }[]): Routes {
  const find = (re: RegExp) => teams.find((t) => re.test(fold(t.name)))?.id ?? null;
  const general = find(/طلبات|عام|استقبال/);
  return {
    تأشيرات: find(/فيزا|تاشير/),
    بكج: find(/مبيعات/) ?? general,
    طيران: find(/طيران|تذاكر/) ?? general,
    فنادق: find(/فنادق|فندق/) ?? general,
    مواصلات: find(/مواصلات|نقل/) ?? general,
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
