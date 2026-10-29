import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { listOpenConversations, teamMembers } from "@/lib/providers/teletel";
import { followupRows } from "@/lib/followups/service";
import { WORK_COLS, type WorkRow } from "@/lib/followups/rules";
import { parseHours } from "@/lib/murad/reception";
import { SETTING } from "@/lib/murad/core";
import { availabilityOf, excusedWindows } from "@/lib/presence/availability";
import { HOLIDAYS_KEY, parseHolidays } from "@/lib/presence/business";
import { parseSupervisionSettings, SUPERVISION_SETTINGS_KEY, type FollowupFacts, type OfficeHours, type SupervisionSettings, type SupervisorRow } from "./core";

/**
 * «إشراف المتابعة» — reading the facts the rules work on, from what «المتابعة»
 * already holds: the open sla_followups, their attempts, the live Teletel
 * conversations, the office hours, the supervisors. Service role; the callers
 * (sweep.ts, actions.ts) gate who may see what.
 */

export const supervisionDb = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const TABLE_MISSING = "42P01";

export async function readSupervisionSettings(db: SupabaseClient): Promise<{ settings: SupervisionSettings; hours: OfficeHours }> {
  const { data } = await db.from("app_settings").select("key, value").in("key", [SUPERVISION_SETTINGS_KEY, SETTING.receptionHours, HOLIDAYS_KEY]);
  const map = new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const settings = parseSupervisionSettings(map.get(SUPERVISION_SETTINGS_KEY));
  // the public holidays are session B's one list (app_settings public_holidays), not a second one here
  settings.holidays = [...new Set([...settings.holidays, ...parseHolidays(map.get(HOLIDAYS_KEY))])];
  return { settings, hours: parseHours(map.get(SETTING.receptionHours)) as OfficeHours };
}

/** the attempts that count as a postpone: a «later» result (التواصل لاحقاً) */
const POSTPONE = "later";

export type FactsBundle = {
  facts: FollowupFacts[];
  rows: Map<string, WorkRow>;
  /** Teletel answered: when not, conversation-based findings are skipped, never guessed */
  teletel: boolean;
};

/** The facts of every OPEN follow-up (or of the given ones). */
export async function readFacts(db: SupabaseClient, onlyFollowupIds?: string[], nowMs = Date.now()): Promise<FactsBundle> {
  const [{ data }, open] = await Promise.all([
    onlyFollowupIds
      ? db.from("sla_followups").select(WORK_COLS).in("id", onlyFollowupIds.length ? onlyFollowupIds : ["00000000-0000-0000-0000-000000000000"]).then((r) => ({ data: (r.data ?? []) as WorkRow[] }))
      : followupRows<WorkRow>((a, b) => db.from("sla_followups").select(WORK_COLS).eq("status", "open").order("id").range(a, b)),
    listOpenConversations().catch(() => null),
  ]);
  const rows = data as WorkRow[];
  const since14 = new Date(nowMs - 14 * 86_400_000).toISOString();
  const ids = rows.map((r) => r.id);
  const postpones = new Map<string, number>();
  if (ids.length) {
    const { data: attempts } = await followupRows<{ followup_id: string; outcome: string | null }>((a, b) =>
      db.from("followup_attempts").select("followup_id,outcome").in("followup_id", ids).eq("outcome", POSTPONE).gte("created_at", since14).order("id").range(a, b),
    );
    for (const at of attempts) postpones.set(at.followup_id, (postpones.get(at.followup_id) ?? 0) + 1);
  }
  const conv = new Map((open?.rows ?? []).map((c) => [c.id, c]));
  // session B: each colleague's leave and status-button windows (not their lateness), and who is exempt from lateness
  const employees = [...new Set(rows.map((r) => r.assigned_to).filter((x): x is string => Boolean(x)))];
  const [excused, availability] = employees.length
    ? await Promise.all([excusedWindows(employees, nowMs - 15 * 86_400_000, nowMs).catch(() => new Map()), availabilityOf(employees, nowMs).catch(() => new Map())])
    : [new Map(), new Map()];
  const facts: FollowupFacts[] = rows.map((r) => {
    const c = conv.get(r.conversation_id);
    return {
      followupId: r.id,
      conversationId: r.conversation_id,
      employeeId: r.assigned_to,
      status: r.status,
      step: r.step,
      heat: r.summary?.heat ?? null,
      nextFollowupAt: r.next_followup_at,
      lastAttemptAt: r.last_attempt_at,
      lastClientAt: r.last_client_at,
      assignedAt: r.assigned_at,
      createdAt: r.created_at,
      lastBy: r.last_by,
      lastLine: r.last_line ?? r.client_line,
      conversation: c ? { waitingSince: c.waitingSince, lastActivityAt: c.lastActivityAt, preview: c.preview, teamId: c.teamId, inboxId: c.inboxId } : null,
      postpones14d: postpones.get(r.id) ?? 0,
      excused: r.assigned_to ? (excused.get(r.assigned_to) ?? []) : [],
      exempt: r.assigned_to ? availability.get(r.assigned_to)?.reason === "exempt" : false,
    };
  });
  return { facts, rows: new Map(rows.map((r) => [r.id, r])), teletel: open !== null };
}

export async function readSupervisors(db: SupabaseClient): Promise<SupervisorRow[] | null> {
  const { data, error } = await db.from("followup_supervisors").select("supervisor_id, scope_kind, scope_ref, role, active");
  if (error) return (error as { code?: string }).code === TABLE_MISSING ? null : [];
  return (data ?? []) as SupervisorRow[];
}

/** employee id → the Teletel teams they belong to (only the teams a supervisor scope names are read) */
export async function teamsOfEmployees(db: SupabaseClient, teamIds: number[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (!teamIds.length) return out;
  const { data: emps } = await db.from("employees").select("id, teletel_agent_id").not("teletel_agent_id", "is", null);
  const byAgent = new Map(((emps ?? []) as { id: string; teletel_agent_id: number | string }[]).map((e) => [Number(e.teletel_agent_id), e.id]));
  for (const team of [...new Set(teamIds)].slice(0, 20)) {
    const members = await teamMembers(team).catch(() => []);
    for (const m of members) {
      const emp = byAgent.get(m.id);
      if (emp) out.set(emp, [...(out.get(emp) ?? []), team]);
    }
  }
  return out;
}

/** Who is at work now — session B's availability (leave, shift, status buttons, Teletel online; «exempt» counts as available). */
export async function availableEmployees(db: SupabaseClient, nowMs = Date.now(), among?: string[]): Promise<Set<string>> {
  let ids = among;
  if (!ids) {
    const { data } = await db.from("employees").select("id").eq("status", "Active");
    ids = ((data ?? []) as { id: string }[]).map((e) => e.id);
  }
  const map = await availabilityOf(ids, nowMs).catch(() => new Map<string, { available: boolean }>());
  return new Set([...map.entries()].filter(([, a]) => a.available).map(([id]) => id));
}
