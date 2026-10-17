/**
 * «SLA» (the owner, 2026-10-17): every open Teletel conversation, by how long
 * it has gone — and the rules the administration writes in minutes, hours or
 * days. Pure: the board, the follow-up list and the tests share it.
 *
 * Three clocks, one per conversation, whichever applies:
 *   first_reply — a new conversation nobody has answered yet: since it began;
 *   waiting     — the client spoke last and waits for us: since their message;
 *   cold        — we spoke last and nothing since: since the last activity
 *                 (a lead going quiet).
 *
 * A rule may move what reaches it — «ينقل إلى»: nowhere, our «المتابعة»
 * (to_followup), or a team in Teletel (teletel_team_id).
 */

export const SLA_KINDS = ["first_reply", "waiting", "cold"] as const;
export type SlaKind = (typeof SLA_KINDS)[number];

export const SLA_UNITS = ["minute", "hour", "day"] as const;
export type SlaUnit = (typeof SLA_UNITS)[number];
const UNIT_MINUTES: Record<SlaUnit, number> = { minute: 1, hour: 60, day: 1440 };

export type SlaRule = {
  id: string;
  kind: SlaKind;
  name: string;
  amount: number;
  unit: SlaUnit;
  color: string;
  /** reaching it sends the conversation to our «المتابعة» */
  to_followup: boolean;
  /** …or hands it to this team in Teletel */
  teletel_team_id: number | null;
  teletel_team_name: string | null;
  active: boolean;
};

export const ruleMinutes = (r: Pick<SlaRule, "amount" | "unit">): number => r.amount * UNIT_MINUTES[r.unit];

/** The conversation's times (unix seconds), as listOpenConversations gives them. */
export type ConversationTimes = { waitingSince: number; firstReplyAt: number | null; lastActivityAt: number; createdAt: number };

export function slaClock(c: ConversationTimes, nowSec: number): { kind: SlaKind; minutes: number } {
  const [kind, since] = !c.firstReplyAt
    ? (["first_reply", c.waitingSince || c.createdAt] as const)
    : c.waitingSince > 0
      ? (["waiting", c.waitingSince] as const)
      : (["cold", c.lastActivityAt] as const);
  return { kind, minutes: Math.max(0, Math.floor((nowSec - since) / 60)) };
}

/** The rule this wait has reached: the active one of its kind with the longest limit not above it — or none (on time). */
export function tierFor(rules: SlaRule[], kind: SlaKind, minutes: number): SlaRule | null {
  let best: SlaRule | null = null;
  for (const r of rules) {
    if (!r.active || r.kind !== kind || ruleMinutes(r) > minutes) continue;
    if (!best || ruleMinutes(r) > ruleMinutes(best)) best = r;
  }
  return best;
}

/**
 * Moved on its own only while the delay is recent: Teletel keeps hundreds of
 * months-old conversations open, and the first look moved 539 of them to
 * «المتابعة» at once — a backlog, not work. Older ones stay on the board for a
 * manager to move by hand.
 */
export const AUTO_FOLLOWUP_MAX_MINUTES = 7 * 1440;

export function autoFollowup(rule: SlaRule | null | undefined, minutes: number): boolean {
  return Boolean(rule?.to_followup) && !rule?.teletel_team_id && minutes <= AUTO_FOLLOWUP_MAX_MINUTES;
}

/** The Teletel team a rule hands this conversation to now — or null: none named, too old, or already there. */
export function autoTeamMove(rule: SlaRule | null | undefined, minutes: number, currentTeamId: number | null): number | null {
  if (!rule?.teletel_team_id || minutes > AUTO_FOLLOWUP_MAX_MINUTES || currentTeamId === rule.teletel_team_id) return null;
  return rule.teletel_team_id;
}

/** «12 دقيقة» / «3 ساعة» / «2 يوم» — the largest whole unit. */
export function waitParts(minutes: number): { n: number; unit: SlaUnit } {
  if (minutes >= 1440) return { n: Math.floor(minutes / 1440), unit: "day" };
  if (minutes >= 60) return { n: Math.floor(minutes / 60), unit: "hour" };
  return { n: minutes, unit: "minute" };
}

// ---------- «قواعد مقترحة بناء على محادثات النظام» ----------

/**
 * Read off the company's own conversations on 2026-10-17: not one client
 * waiting for us was answered within the hour, half waited about three days,
 * and 171 conversations went quiet after our reply in a week. Each suggestion
 * names what it catches today (`hits`, the recent ones a manager can still act
 * on). New conversations go to «قسم الطلبات» (Teletel's «جديد» stage says it
 * receives them), quiet leads and late answers to «متابعة المبيعات», a day
 * without an answer to our «المتابعة» for a manager to hand out — when those
 * teams exist; without them, to our «المتابعة».
 */
const SUGGESTED = [
  { key: "first_15m", kind: "first_reply", name: "عميل جديد بلا رد", amount: 15, unit: "minute", color: "#c22850", to: /الطلبات/ },
  { key: "waiting_30m", kind: "waiting", name: "تنبيه رد", amount: 30, unit: "minute", color: "#d99a00", to: null },
  { key: "waiting_4h", kind: "waiting", name: "حرج", amount: 4, unit: "hour", color: "#c22850", to: /متابعة المبيعات/ },
  { key: "waiting_1d", kind: "waiting", name: "متروك يوماً", amount: 1, unit: "day", color: "#7a1030", to: "system" },
  { key: "cold_1d", kind: "cold", name: "فاتر", amount: 1, unit: "day", color: "#6b7a99", to: null },
  { key: "cold_3d", kind: "cold", name: "بارد — فرصة بيع", amount: 3, unit: "day", color: "#2f7fc0", to: /متابعة المبيعات/ },
] as const satisfies readonly { key: string; kind: SlaKind; name: string; amount: number; unit: SlaUnit; color: string; to: RegExp | "system" | null }[];

export type SuggestionKey = (typeof SUGGESTED)[number]["key"];
export type Suggestion = {
  key: SuggestionKey;
  rule: Omit<SlaRule, "id">;
  /** the recent conversations (a week) it catches now */
  hits: number;
  /** all open conversations of its kind */
  ofKind: number;
  /** a rule of the same kind and limit, moving to the same place, is already there */
  exists: boolean;
  /** a rule of the same kind and limit that moves elsewhere — the suggestion would update it */
  replaces: string | null;
};

export function suggestRules(
  rows: { kind: SlaKind; minutes: number }[],
  teams: { id: number; name: string }[],
  existing: SlaRule[],
): Suggestion[] {
  return SUGGESTED.map((s) => {
    const team = s.to instanceof RegExp ? teams.find((t) => s.to instanceof RegExp && s.to.test(t.name)) : undefined;
    const rule: Omit<SlaRule, "id"> = {
      kind: s.kind,
      name: s.name,
      amount: s.amount,
      unit: s.unit,
      color: s.color,
      // a team that is not there falls back to our «المتابعة»
      to_followup: s.to === "system" || (s.to instanceof RegExp && !team),
      teletel_team_id: team?.id ?? null,
      teletel_team_name: team?.name ?? null,
      active: true,
    };
    const limit = ruleMinutes(rule);
    const ofKind = rows.filter((r) => r.kind === s.kind);
    const twin = existing.find((e) => e.kind === s.kind && ruleMinutes(e) === limit);
    const same = Boolean(twin) && (twin?.teletel_team_id ?? null) === rule.teletel_team_id && Boolean(twin?.to_followup) === rule.to_followup;
    return {
      key: s.key,
      rule,
      hits: ofKind.filter((r) => r.minutes >= limit && r.minutes <= AUTO_FOLLOWUP_MAX_MINUTES).length,
      ofKind: ofKind.length,
      exists: same,
      replaces: twin && !same ? twin.id : null,
    };
  });
}
