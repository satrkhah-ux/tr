import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { listOpenConversations } from "@/lib/providers/teletel";
import { parseSettings, rankDay, type DayItem, type DaySettings, type FollowRow, type Mark, type Reminder } from "./rank";

/**
 * «متابعتي» — read side, server only, for the page, the bot and «سكرتيري الخاص».
 * Every function takes the employee it is about; the CALLER checks who may ask
 * (src/lib/data/my-followups.ts for the page). Nothing here writes.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
export const SETTINGS_KEY = (employeeId: string) => `my_followup_settings:${employeeId}`;
const ROW_COLS = "id,conversation_id,contact_name,contact_phone,status,step,next_followup_at,client_waiting,last_attempt_at,last_client_at,offer_id,offer_line,destination,summary";

export async function loadSettings(employeeId: string): Promise<DaySettings> {
  const { data } = await db().from("app_settings").select("value").eq("key", SETTINGS_KEY(employeeId)).maybeSingle();
  return parseSettings((data as { value?: string } | null)?.value);
}

export type MyDay = {
  items: DayItem[];
  settings: DaySettings;
  agentId: number | null;
  /** false: Teletel could not be read, the list holds the offer follow-ups and reminders only */
  teletel: boolean;
};

/** «عليّ اليوم» for one employee: their open conversations, their «المتابعة» files, their marks and reminders. */
export async function myDay(employeeId: string, nowMs = Date.now()): Promise<MyDay | null> {
  const service = db();
  const { data: emp } = await service.from("employees").select("teletel_agent_id").eq("id", employeeId).maybeSingle();
  if (!emp) return null;
  const agentId = (emp as { teletel_agent_id: number | null }).teletel_agent_id ?? null;
  const [open, rows, marks, reminders, settings] = await Promise.all([
    agentId ? listOpenConversations() : Promise.resolve({ rows: [], at: nowMs }),
    service.from("sla_followups").select(ROW_COLS).eq("assigned_to", employeeId).eq("status", "open"),
    // the two tables are «متابعتي»'s own (20261026090000); before they exist the page still lists, with nothing done or snoozed
    service.from("my_followup_marks").select("key,done_at,note").eq("employee_id", employeeId).like("key", "c:%"),
    service.from("my_followup_reminders").select("id,conversation_id,text,due_at,done_at").eq("employee_id", employeeId).is("done_at", null),
    loadSettings(employeeId),
  ]);
  const markMap = new Map<number, Mark>(((marks.data ?? []) as { key: string; done_at: string | null; note: string | null }[]).map((m) => [Number(m.key.slice(2)), { done_at: m.done_at, note: m.note }]));
  const items = rankDay({
    agentId,
    open: open?.rows ?? [],
    rows: (rows.data ?? []) as FollowRow[],
    marks: markMap,
    reminders: ((reminders.data ?? []) as Reminder[]).map((r) => ({ ...r, conversation_id: r.conversation_id === null ? null : Number(r.conversation_id) })),
    settings,
    nowMs,
  });
  return { items, settings, agentId, teletel: open !== null };
}

/** the hot clients on their list today (Murad reads them as hot), for «سكرتيري الخاص» */
export async function hotClients(employeeId: string, nowMs = Date.now()): Promise<DayItem[]> {
  return ((await myDay(employeeId, nowMs))?.items ?? []).filter((i) => i.heat === "hot");
}
