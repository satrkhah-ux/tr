import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { agentSummaries, countAgentConversations, listOpenConversations, type AgentSummary, type OpenConversation } from "@/lib/providers/teletel";

/**
 * One employee's numbers, from Teletel itself. They are the employee's own
 * numbers and nobody else's.
 *   now   — open conversations held, and of those, the ones waiting for a reply
 *           (the client spoke last) and the ones never answered at all. These
 *           come from the open list the minute job already keeps fresh.
 *   all   — every conversation ever assigned, and the closed ones (Teletel's
 *           own count).
 *   today — Riyadh's day: transfers that reached them (our log), and Teletel's
 *           report for the day (resolved, average first response and reply).
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const RIYADH = 3 * 3600; // UTC+3 all year, no DST

/** Unix seconds at 00:00 Riyadh of the day `nowMs` falls in. */
export function riyadhDayStart(nowMs: number): number {
  const sec = Math.floor(nowMs / 1000);
  return Math.floor((sec + RIYADH) / 86400) * 86400 - RIYADH;
}

export type MyNumbers = {
  open: number;
  waiting: number;
  neverAnswered: number;
  oldestWaitMin: number | null;
  total: number | null;
  closed: number | null;
  today: { assigned: number; report: AgentSummary | null };
};

/** Open conversations held by this agent, waiting ones first (oldest wait first). Null when Teletel cannot be read. */
export async function openFor(agentId: number): Promise<OpenConversation[] | null> {
  const list = await listOpenConversations();
  if (!list) return null;
  return list.rows
    .filter((r) => r.assigneeId === agentId)
    .sort((a, b) => (a.waitingSince || Infinity) - (b.waitingSince || Infinity));
}

export async function myNumbers(agentId: number, nowMs = Date.now()): Promise<MyNumbers | null> {
  const since = riyadhDayStart(nowMs);
  const [open, total, closed, report, assigned] = await Promise.all([
    openFor(agentId),
    countAgentConversations(agentId, "all"),
    countAgentConversations(agentId, "resolved"),
    agentSummaries(since, Math.floor(nowMs / 1000)),
    db()
      .from("staff_bot_assignments")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agentId)
      .gte("created_at", new Date(since * 1000).toISOString()),
  ]);
  if (!open) return null;
  const waiting = open.filter((c) => c.waitingSince > 0);
  const oldest = waiting.length ? Math.min(...waiting.map((c) => c.waitingSince)) : null;
  return {
    open: open.length,
    waiting: waiting.length,
    neverAnswered: open.filter((c) => !c.firstReplyAt).length,
    oldestWaitMin: oldest ? Math.max(0, Math.floor((nowMs / 1000 - oldest) / 60)) : null,
    total,
    closed,
    today: { assigned: assigned.count ?? 0, report: report?.get(agentId) ?? null },
  };
}

/** «١٢ د»، «٢ س ٥ د»، «٣ ي» with Latin digits, as the rest of the system writes times. */
export function waitText(minutes: number): string {
  if (minutes < 60) return `${minutes} د`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} س${minutes % 60 ? ` ${minutes % 60} د` : ""}`;
  return `${Math.floor(minutes / 1440)} ي`;
}

/** Seconds of Teletel's averages → the same words; «—» for none. */
export const secondsText = (sec: number | null | undefined): string => (sec == null ? "—" : waitText(Math.max(1, Math.round(sec / 60))));
