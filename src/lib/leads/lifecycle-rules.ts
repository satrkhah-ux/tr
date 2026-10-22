import { fold } from "./sheet";

/** Pure rules of the conversation's life in Teletel — the doing is lifecycle.ts. */

export type ClosedBy = "employee" | "system" | "murad";
export type TeletelAgent = { id: number; name: string; email: string | null };

// Teletel's own activity line, Arabic and English
const CLOSED = /^تم تحديث حالة المحادثة لـ\s*"?مغلقة"?\s*بواسطة\s+(.+)$|^Conversation was marked resolved by\s+(.+)$/u;

/**
 * Who resolved it: the latest «…"مغلقة" بواسطة X» at or before `before`,
 * matched to a Teletel agent by name or email. Null when no person closed it
 * (Teletel's own auto-resolve, or no line read).
 */
export function closerOf(events: readonly { kind: string; at: number; text: string }[], before: number, agents: readonly TeletelAgent[]): { name: string; agentId: number | null; at: number } | null {
  const line = events
    .filter((e) => e.kind === "activity" && e.at <= before)
    .map((e) => ({ e, m: e.text.replace(/\s+/g, " ").trim().match(CLOSED) }))
    .filter((x) => x.m)
    .sort((a, b) => b.e.at - a.e.at)[0];
  if (!line?.m) return null;
  const name = (line.m[1] ?? line.m[2]).trim();
  const agent = agents.find((a) => fold(a.name) === fold(name) || (a.email && a.email.toLowerCase() === name.toLowerCase()));
  return { name: agent?.name.trim() ?? name, agentId: agent?.id ?? null, at: line.e.at };
}

export type ReturnDecision = { act: "assign"; agentId: number } | { act: "keep" } | { act: "unassign" };

/**
 * The client wrote again: the employee who closed it gets it back (already
 * theirs: nothing to do); the system's closing comes back unassigned — Teletel's
 * intake takes it as a new request.
 */
export function decideReturn(closure: { closed_by_kind: ClosedBy; closed_by_agent_id: number | null }, assigneeId: number | null): ReturnDecision {
  if (closure.closed_by_kind !== "employee") return { act: "unassign" };
  if (!closure.closed_by_agent_id || closure.closed_by_agent_id === assigneeId) return { act: "keep" };
  return { act: "assign", agentId: closure.closed_by_agent_id };
}

/** «إدارة المحادثات»: how long without a reply before the system closes one (app_settings), null = off */
export const AUTOCLOSE_SETTING = "conversation_autoclose_hours";
export const readAutocloseHours = (raw: string | null | undefined): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 24 * 90 ? Math.round(n) : null;
};

/** The system closes only what nobody is waiting on: idle `hours` and WE spoke last — the oldest first. */
export function staleToClose<T extends { lastActivityAt: number; waitingSince: number }>(rows: readonly T[], nowSec: number, hours: number): T[] {
  if (!(hours > 0)) return [];
  return rows.filter((c) => c.waitingSince === 0 && c.lastActivityAt > 0 && c.lastActivityAt <= nowSec - hours * 3600).sort((a, b) => a.lastActivityAt - b.lastActivityAt);
}

/** «3 أيام»، «36 ساعة» */
export function durationText(hours: number): string {
  if (hours % 24) return hours === 1 ? "ساعة" : hours === 2 ? "ساعتين" : `${hours} ${hours <= 10 ? "ساعات" : "ساعة"}`;
  const d = hours / 24;
  return d === 1 ? "يوم" : d === 2 ? "يومين" : `${d} ${d <= 10 ? "أيام" : "يوماً"}`;
}
