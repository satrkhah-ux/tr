import { fold } from "./sheet";

/**
 * «العملاء» phase two: what a Teletel conversation says about itself, with no
 * one typing it — the kind of request and the place, read from its labels and
 * the client's words. Rules, not guesses: nothing found → empty, and «يستفسر»
 * only for a conversation that says something without naming a service.
 */

/** the service a client names, first match wins — patterns are written folded (fold(): no spaces, no hamza, ه for ة) (a visa before a flight: «تأشيرة وتذكرة» is a visa file) */
const KINDS: [string, RegExp][] = [
  ["بكج", /(بكج|باكج|باكدج|بكدج|باقه|باقات|برنامجسياحي|بكجات|package)/i],
  ["تأشيرات", /(تاشير|فيزا|فيزه|visa)/i],
  ["فنادق", /(فندق|فنادق|حجزغرف|hotel)/i],
  ["طيران", /(طيران|تذكره|تذاكر|حجزرحله|رحلهطيران|flight|ticket)/i],
  ["مواصلات", /(مواصلات|سياره|سائق|توصيل|استقبالمنالمطار|transfer)/i],
];

/** «بكج» … from the labels first (staff put them), else the client's words; «يستفسر» when they wrote but named nothing */
export function classifyInquiry(labels: string[], text: string): string {
  for (const source of [labels.join(" "), text]) {
    const f = fold(source);
    for (const [label, re] of KINDS) if (re.test(f)) return label;
  }
  return text.trim() ? "يستفسر" : "";
}

export type Place = { name: string; country: string };

/**
 * The first place the conversation names — a country, or a city (reported as
 * its city, «طرابزون»). Longest names first, so «الشمال التركي» wins over «تركيا»
 * and «كوالالمبور» over nothing. Labels («رحلة ماليزيا») before the text.
 */
export function findPlace(labels: string[], text: string, places: Place[]): string {
  const sorted = [...places].filter((p) => fold(p.name).length >= 3).sort((a, b) => fold(b.name).length - fold(a.name).length);
  for (const source of [labels.join(" "), text]) {
    const f = fold(source);
    if (!f) continue;
    const hit = sorted.find((p) => f.includes(fold(p.name)));
    if (hit) return hit.name;
  }
  return "";
}

/**
 * When a conversation went to `assignee`: the latest activity line naming them
 * («Assigned to X by Y», «تم التعيين إلى X») at or before `by` — null when the
 * page holds none (the caller keeps the time it saw the change).
 */
export function assignedAtFrom(events: { at: number; kind: string; text: string }[], assignee: string | null, by: number): number | null {
  if (!assignee) return null;
  const name = fold(assignee);
  const hits = events.filter((e) => e.kind === "activity" && e.at <= by && fold(e.text).includes(name));
  return hits.length ? Math.max(...hits.map((e) => e.at)) : null;
}

/** The first reply to the client from `from` on — by `assignee` when their Teletel name is known, else by anyone of ours. A private note is no reply. */
export function replyAfter(events: { at: number; kind: string; sender: string | null; isPrivate: boolean }[], from: number, assignee: string | null): number | null {
  const name = assignee ? fold(assignee) : null;
  const hits = events.filter((e) => e.kind === "agent" && !e.isPrivate && e.at >= from && (!name || (e.sender != null && fold(e.sender) === name)));
  return hits.length ? Math.min(...hits.map((e) => e.at)) : null;
}

/** «تأخير المحادثة» as the clock says it: how long the client has waited, or how long the first reply took */
export function delayText(c: { waitingSince: number; firstReplyAt: number | null; createdAt: number }, nowSec: number): string {
  const span = (sec: number) => {
    const m = Math.max(0, Math.round(sec / 60));
    if (m < 60) return `${m} دقيقة`;
    if (m < 1440) return `${Math.round(m / 60)} ساعة`;
    return `${Math.round(m / 1440)} يوم`;
  };
  if (c.waitingSince > 0) return `ينتظر ردنا منذ ${span(nowSec - c.waitingSince)}`;
  if (c.firstReplyAt && c.createdAt) return `أول رد بعد ${span(c.firstReplyAt - c.createdAt)}`;
  return "";
}
