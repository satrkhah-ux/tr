/**
 * «متابعتي» — what is on the employee today, one card per client, most pressing first
 * (the owner, 2026-10-25: «قسم متابعة يتابع محادثاته ويساعده أن يكون هو متابعة على نفسه»).
 *
 *   1. waiting  — the client wrote last and waits for our reply
 *   2. silent   — we wrote last and the client has been quiet this long (an offer sent first)
 *   3. hot      — Murad reads them as hot, and we have not spoken to them today
 *   4. offer    — an offer's follow-up step is due, or its client wrote back («المتابعة», same rows)
 *   5. reminder — «ذكّرني» that came due
 *
 * A client with several reasons is one card: the first reason is its kind, the rest its tags.
 * «تمّت» hides the card until something new happens on it; a pending «ذكّرني» hides it until due.
 *
 * Pure: the conversations, the follow-up rows, the marks and the reminders are parameters.
 */

import type { FollowupSummary } from "@/lib/followups/summary-core";

export type DayKind = "waiting" | "silent" | "hot" | "offer" | "reminder";
export const KIND_ORDER: DayKind[] = ["waiting", "silent", "hot", "offer", "reminder"];
export const KIND_LABEL: Record<DayKind, string> = {
  waiting: "ينتظر ردّك",
  silent: "سكت بعد رسالتك",
  hot: "عميل ساخن",
  offer: "متابعة عرض",
  reminder: "تذكير",
};

/** what the board needs of a Teletel open conversation (providers/teletel OpenConversation) */
export type OpenConv = { id: number; name: string; phone: string; assigneeId: number | null; waitingSince: number; lastActivityAt: number; canReply: boolean; preview: string };
/** what it needs of a «المتابعة» row (followups/rules WorkRow) */
export type FollowRow = {
  id: string;
  conversation_id: number;
  contact_name: string | null;
  contact_phone: string | null;
  status: "open" | "done";
  step: number | null;
  next_followup_at: string | null;
  client_waiting: boolean;
  last_attempt_at: string | null;
  last_client_at: string | null;
  offer_id: string | null;
  offer_line: string | null;
  destination: string | null;
  summary: FollowupSummary | null;
};
export type Mark = { done_at: string | null; note: string | null };
export type Reminder = { id: number; conversation_id: number | null; text: string; due_at: string; done_at: string | null };
export type DaySettings = {
  /** hours after our last message before a quiet client shows */
  silentHours: number;
  /** minutes a client may wait before the bot's first «⏰ ينتظر ردك» (the board shows every waiting client) */
  waitMinutes: number;
  /** minutes after the first reminder for the second one (none past three hours of waiting) */
  repeatMinutes: number;
  /** Riyadh hours with no bot message: from → to (22 → 9 wraps midnight) */
  quietFrom: number;
  quietTo: number;
};
// 15 and 60 minutes, 09:00–23:00: what «⏰ ينتظر ردك» did before anyone set anything
export const DEFAULT_SETTINGS: DaySettings = { silentHours: 24, waitMinutes: 15, repeatMinutes: 45, quietFrom: 23, quietTo: 9 };

export type DayItem = {
  key: string;
  kind: DayKind;
  tags: DayKind[];
  conversationId: number | null;
  name: string;
  phone: string | null;
  /** ms: since when the client waits / since our last message / when the step or reminder came due */
  since: number | null;
  wants: string | null;
  next: FollowupSummary["next"] | null;
  advice: string | null;
  heat: FollowupSummary["heat"] | null;
  offerLine: string | null;
  destination: string | null;
  followupId: string | null;
  step: number | null;
  /** inside WhatsApp's 24 hours (a free text reaches them) */
  canReply: boolean | null;
  preview: string | null;
  reminder: { id: number; text: string; dueAt: string } | null;
  note: string | null;
};

const riyadhDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(ms);
const ms = (at: string | null) => (at ? Date.parse(at) : 0);

export function parseSettings(raw: string | null | undefined): DaySettings {
  let v: Partial<DaySettings> = {};
  try {
    v = JSON.parse(raw ?? "{}") as Partial<DaySettings>;
  } catch {
    /* defaults */
  }
  const n = (x: unknown, min: number, max: number, d: number) => (typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? Math.round(x) : d);
  return {
    silentHours: n(v.silentHours, 1, 24 * 14, DEFAULT_SETTINGS.silentHours),
    waitMinutes: n(v.waitMinutes, 5, 120, DEFAULT_SETTINGS.waitMinutes),
    repeatMinutes: n(v.repeatMinutes, 10, 180, DEFAULT_SETTINGS.repeatMinutes),
    quietFrom: n(v.quietFrom, 0, 23, DEFAULT_SETTINGS.quietFrom),
    quietTo: n(v.quietTo, 0, 23, DEFAULT_SETTINGS.quietTo),
  };
}

/** inside the quiet hours (Riyadh)? equal from/to = never quiet */
export function quiet(s: Pick<DaySettings, "quietFrom" | "quietTo">, nowMs: number): boolean {
  const h = new Date(nowMs + 3 * 3600_000).getUTCHours();
  if (s.quietFrom === s.quietTo) return false;
  return s.quietFrom < s.quietTo ? h >= s.quietFrom && h < s.quietTo : h >= s.quietFrom || h < s.quietTo;
}

/** a wait older than this is not reminded: it is on the list and in the evening report, and a deploy cannot flood anyone */
export const STOP_REMINDING_AT = 180;

/**
 * The minutes of waiting at which «⏰ ينتظر ردك» goes: the employee's first, then
 * one repeat; a hot client (Murad) also at five minutes.
 */
export function waitLevels(s: Pick<DaySettings, "waitMinutes" | "repeatMinutes">, hot: boolean): number[] {
  return [...new Set([...(hot ? [5] : []), s.waitMinutes, s.waitMinutes + s.repeatMinutes])].filter((m) => m < STOP_REMINDING_AT).sort((a, b) => a - b);
}

/** the level this wait sits in now (each level reminds once, claimed per waiting episode), or null */
export function waitLevelNow(levels: number[], minutes: number): number | null {
  const i = levels.findIndex((l, k) => minutes >= l && minutes < (levels[k + 1] ?? STOP_REMINDING_AT));
  return i < 0 ? null : levels[i];
}

export function rankDay(input: {
  agentId: number | null;
  open: OpenConv[];
  rows: FollowRow[];
  marks: Map<number, Mark>;
  reminders: Reminder[];
  settings: DaySettings;
  nowMs: number;
}): DayItem[] {
  const { agentId, rows, marks, reminders, settings, nowMs } = input;
  const open = new Map(input.open.filter((c) => agentId !== null && c.assigneeId === agentId).map((c) => [c.id, c]));
  const byConv = new Map(rows.filter((r) => r.status === "open").map((r) => [r.conversation_id, r]));
  const pending = new Set(reminders.filter((r) => !r.done_at && r.conversation_id !== null && ms(r.due_at) > nowMs).map((r) => r.conversation_id as number));
  const today = riyadhDay(nowMs);
  const items: DayItem[] = [];

  const card = (id: number, kinds: DayKind[], since: number | null, reminder: Reminder | null): DayItem => {
    const c = open.get(id);
    const r = byConv.get(id);
    const s = r?.summary ?? null;
    return {
      key: reminder ? `r:${reminder.id}` : `c:${id}`,
      kind: reminder ? "reminder" : kinds[0],
      tags: reminder ? kinds : kinds.slice(1),
      conversationId: id,
      name: c?.name || r?.contact_name || `عميل #${id}`,
      phone: c?.phone || r?.contact_phone || null,
      since,
      wants: s?.wants || null,
      next: s?.next ?? null,
      advice: s?.advice || null,
      heat: s?.heat ?? null,
      offerLine: r?.offer_line ?? null,
      destination: r?.destination ?? (s?.destination || null),
      followupId: r?.id ?? null,
      step: r?.step ?? null,
      canReply: c ? c.canReply : null,
      preview: c?.preview || null,
      reminder: reminder ? { id: reminder.id, text: reminder.text, dueAt: reminder.due_at } : null,
      note: marks.get(id)?.note ?? null,
    };
  };

  /** why this client is on the list today, most pressing first; none when «تمّت» came after the last news */
  const reasonsFor = (id: number): [DayKind, number | null][] => {
    const c = open.get(id);
    const r = byConv.get(id);
    const lastMs = c ? c.lastActivityAt * 1000 : 0;
    const talkedToday = (c !== undefined && !c.waitingSince && riyadhDay(lastMs) === today) || (r?.last_attempt_at ? riyadhDay(ms(r.last_attempt_at)) === today : false);
    const due = r && ms(r.next_followup_at) && ms(r.next_followup_at) <= nowMs ? ms(r.next_followup_at) : 0;
    const reasons: [DayKind, number | null][] = [];
    if (c && c.waitingSince) reasons.push(["waiting", c.waitingSince * 1000]);
    if (c && !c.waitingSince && nowMs - lastMs >= settings.silentHours * 3600_000) reasons.push(["silent", lastMs]);
    if (r?.summary?.heat === "hot" && !talkedToday) reasons.push(["hot", lastMs || ms(r.last_client_at) || null]);
    if (r && (r.client_waiting || due)) reasons.push(["offer", r.client_waiting ? ms(r.last_client_at) || null : due]);
    // «تمّت»: gone until the client writes, the conversation moves, or the next step comes due
    const done = ms(marks.get(id)?.done_at ?? null);
    return done && done > Math.max(lastMs, ms(r?.last_client_at ?? null), due) ? [] : reasons;
  };
  const dueReminder = new Set(reminders.filter((r) => !r.done_at && r.conversation_id !== null && ms(r.due_at) <= nowMs).map((r) => r.conversation_id as number));

  for (const id of new Set([...open.keys(), ...byConv.keys()])) {
    // a client under «ذكّرني» shows as that reminder (once due), not twice
    if (pending.has(id) || dueReminder.has(id)) continue;
    const reasons = reasonsFor(id);
    if (reasons.length) items.push(card(id, reasons.map(([k]) => k), reasons[0][1], null));
  }

  for (const rem of reminders) {
    if (rem.done_at || ms(rem.due_at) > nowMs) continue;
    if (rem.conversation_id === null) {
      items.push({
        key: `r:${rem.id}`,
        kind: "reminder",
        tags: [],
        conversationId: null,
        name: rem.text || "تذكير",
        phone: null,
        since: ms(rem.due_at),
        wants: null,
        next: null,
        advice: null,
        heat: null,
        offerLine: null,
        destination: null,
        followupId: null,
        step: null,
        canReply: null,
        preview: null,
        reminder: { id: rem.id, text: rem.text, dueAt: rem.due_at },
        note: null,
      });
      continue;
    }
    items.push(card(rem.conversation_id, reasonsFor(rem.conversation_id).map(([k]) => k), ms(rem.due_at), rem));
  }

  // the brief's order; inside a kind: the longest wait, a quiet client with an offer before one without, a hot client first
  const rank = (i: DayItem) => KIND_ORDER.indexOf(i.kind);
  return items.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.kind === "silent" ? Number(!a.offerLine) - Number(!b.offerLine) : 0) ||
      Number(b.heat === "hot") - Number(a.heat === "hot") ||
      (a.since ?? nowMs) - (b.since ?? nowMs),
  );
}

/** the counts the badge and the start-of-day message say */
export function dayCounts(items: DayItem[]): Record<DayKind, number> & { total: number } {
  const out = { waiting: 0, silent: 0, hot: 0, offer: 0, reminder: 0, total: items.length };
  for (const i of items) out[i.kind] += 1;
  return out;
}
