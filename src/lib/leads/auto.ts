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

/** a service the client says they do NOT want — «رحلة جورجيا بدون طيران» is no flight request */
const NOT_WANTED = /(?:بدون|بلا|من غير|غير شامل|ما يحتاج|ماابي|ما ابي|مو محتاج)\s*(?:ال)?(?:طيران|تذاكر|تذكرة|تذكره|فندق|فنادق|سكن|تأشيرة|تاشيرة|تأشيره|فيزا|مواصلات|سيارة)/gu;

/** «بكج» … from the labels first (staff put them), else the client's words; «يستفسر» when they wrote but named nothing */
export function classifyInquiry(labels: string[], text: string): string {
  for (const source of [labels.join(" "), text.replace(NOT_WANTED, " ")]) {
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
 * Who a Teletel activity line hands the conversation to, and by whom — as the
 * account writes them in Arabic (and Chatwoot's English):
 *   «تم إسنادها إلى X بواسطة Y» · «تم تعيينه إلى X عبر قسم … بواسطة Y» ·
 *   «X تم تعيينه تلقائياً لهذه المحادثة». Anything else (an unassignment, a
 *   label) is null.
 */
export function parseAssignment(text: string): { agent: string; by: string | null } | null {
  const t = text.replace(/\s+/g, " ").trim();
  const m =
    t.match(/^تم تعيينه إلى (.+?) عبر .+? بواسطة (.+)$/u) ??
    t.match(/^تم إسنادها إلى (.+?) بواسطة (.+)$/u) ??
    t.match(/^Assigned to (.+?) via .+? by (.+)$/) ??
    t.match(/^Assigned to (.+?) by (.+)$/);
  if (m) return { agent: m[1].trim(), by: m[2].trim() };
  const self = t.match(/^(.+?) تم تعيينه تلقائياً لهذه المحادثة$/u) ?? t.match(/^(.+?) (?:self-assigned|was assigned)/);
  return self ? { agent: self[1].trim(), by: null } : null;
}

/** One agent's turn with a conversation: from when it reached them, their first reply, when they handed it on — epoch seconds. */
export type Stage = { agent: string; from: number; reply: number | null; handed: number | null; by: string | null };

/**
 * The conversation's turns, in order (the owner, 2026-10-18: «الموظف الذي استلم
 * اول مرة … كم احتاج وقت لاستلام الرسالة و كم احتاج وقت لاسنادها لموظف آخر و
 * الموظف الآخر كم احتاج وقت للتعامل معها»). A hand-over to an agent starts a
 * turn and ends the one before; one to a team («قسم …», `isTeam`) is a queue,
 * not a person. A turn starts when the conversation reached the agent; before
 * any hand-over, the first of ours to answer is the first receiver, their turn
 * starting with the client's first message (`start`). A
 * turn's reply is its agent's first public message — a private note, or a
 * colleague answering, is not theirs. `ignore`: our own automatic replies
 * («مُراد», «المستقبل الآلي»), written in Teletel as the API token's user —
 * never anyone's turn.
 */
export function timelineFrom(
  events: { id?: number; at: number; kind: string; text: string; sender: string | null; isPrivate: boolean }[],
  start: number,
  isTeam: (name: string) => boolean,
  ignore: ReadonlySet<number> = new Set(),
): Stage[] {
  const stages: Stage[] = [];
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (e.id != null && ignore.has(e.id)) continue;
    const last = stages[stages.length - 1];
    if (e.kind === "activity") {
      const a = parseAssignment(e.text);
      if (!a || isTeam(a.agent) || (last && fold(last.agent) === fold(a.agent))) continue;
      if (last && last.handed == null) last.handed = e.at;
      stages.push({ agent: a.agent, from: e.at, reply: null, handed: null, by: a.by });
    } else if (e.kind === "agent" && !e.isPrivate && e.sender) {
      if (!last) stages.push({ agent: e.sender, from: start || e.at, reply: e.at, handed: null, by: null });
      else if (last.reply == null && fold(e.sender) === fold(last.agent)) last.reply = e.at;
    }
  }
  return stages;
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
