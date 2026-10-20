import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { listOpenConversations, teletelGet, type OpenConversation } from "@/lib/providers/teletel";
export async function followupRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ data: T[] }> {
  const data: T[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await page(from, from + 999);
    if (result.error) throw new Error("followup query unavailable");
    data.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 1000) return { data };
  }
}
import { grantedPermissions } from "@/lib/roles/roles";
import { WORK_COLS, type WorkRow } from "./rules";

export const followupDb = () => createSupabaseServiceClient() as unknown as SupabaseClient;
export async function followupPeople() {
  const { data, error } = await followupDb().from("employees").select("id,arabic_name,status,extra_permission_keys,removed_permission_keys,roles(permission_keys)").eq("status", "Active");
  if (error) throw new Error("employees unavailable");
  type Person = { id: string; arabic_name: string; status: string; extra_permission_keys: string[] | null; removed_permission_keys: string[] | null; roles: { permission_keys: string[] } | null };
  return ((data ?? []) as unknown as Person[]).filter((p) => {
    const keys = grantedPermissions({ ...p, permission_keys: p.roles?.permission_keys ?? [] });
    return keys.some((k) => ["followups.work", "followups.manage", "dashboard.admin", "developer.access"].includes(k));
  }).map((p) => ({ id: p.id, name: p.arabic_name }));
}
export async function followupTeamId(): Promise<number> {
  const { data, error } = await followupDb().from("app_settings").select("value").eq("key", "followup_team_id").maybeSingle();
  if (error) throw new Error("followup settings unavailable");
  const id = Number(data?.value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("followup team not configured");
  return id;
}
export async function enrollFollowup(c: OpenConversation, source: "manual" | "teletel" | "sla", reason: string, actor: string | null = null): Promise<string> {
  const db = followupDb();
  const { data: active, error: activeError } = await db.from("sla_followups").select("id").eq("conversation_id", c.id).eq("status", "open").maybeSingle();
  if (activeError) throw new Error("followup read failed");
  if (active) return String(active.id);
  const [{ data: lead }, { data: map }, people] = await Promise.all([
    db.from("client_leads").select("last_visit_at,created_at").eq("teletel_conversation_id", c.id).maybeSingle(),
    db.from("followup_agent_map").select("employee_id").eq("agent_id", c.assigneeId ?? -1).maybeSingle(),
    followupPeople(),
  ]);
  const employee = map && people.some((p) => p.id === map.employee_id) ? String(map.employee_id) : null;
  const { data, error } = await db.from("sla_followups").insert({
    conversation_id: c.id, contact_id: c.contactId, contact_name: c.name, contact_phone: c.phone,
    kind: "waiting", status: "open", stage: employee ? "working" : "new",
    assigned_to: employee, assigned_at: employee ? new Date().toISOString() : null, assigned_by: actor,
    teletel_assignee: c.assignee, source, source_team_id: c.teamId, transfer_reason: reason,
    request_started_at: new Date(Math.max(Date.parse(lead?.last_visit_at ?? lead?.created_at ?? "") || 0, c.waitingSince * 1000 || 0, c.createdAt * 1000)).toISOString(),
    last_client_at: c.waitingSince ? new Date(c.waitingSince * 1000).toISOString() : null,
    external_status: "open",
  }).select("id").single();
  if (error) {
    if (error.code === "23505") {
      const existing = await db.from("sla_followups").select("id").eq("conversation_id", c.id).eq("status", "open").single();
      if (existing.data) return String(existing.data.id);
    }
    throw new Error("followup enrollment failed");
  }
  return String(data.id);
}

/** Read-only Teletel synchronization. No messages, team moves, or SLA activation. */
export async function syncFollowups() {
  const db = followupDb();
  const [teamId, fetched, { data: stored }] = await Promise.all([
    followupTeamId(), listOpenConversations(true),
    followupRows((a, b) => db.from("sla_followups").select(WORK_COLS).order("created_at").range(a, b)),
  ]);
  if (!fetched) throw new Error("followup sync unavailable");
  const rows = (stored ?? []) as WorkRow[];
  const active = new Map(rows.filter((r) => r.status === "open").map((r) => [r.conversation_id, r]));
  const latestDone = new Map<number, WorkRow>();
  for (const row of rows) if (row.status === "done") {
    const prev = latestDone.get(row.conversation_id);
    if (!prev || Date.parse(row.done_at ?? row.created_at) > Date.parse(prev.done_at ?? prev.created_at)) latestDone.set(row.conversation_id, row);
  }
  let added = 0, awakened = 0;
  const now = new Date().toISOString();
  for (const c of fetched.rows) {
    const row = active.get(c.id);
    if (!row && c.teamId === teamId) {
      const done = latestDone.get(c.id);
      if (done && c.waitingSince * 1000 <= Date.parse(done.done_at ?? done.created_at)) continue;
      await enrollFollowup(c, "teletel", done ? "عودة العميل بطلب جديد" : "تحويل إلى فريق متابعة المبيعات");
      added++;
    } else if (row) {
      const patch: Record<string, unknown> = { last_synced_at: now, external_status: "open" };
      const incomingAt = c.waitingSince ? new Date(c.waitingSince * 1000).toISOString() : null;
      if (incomingAt && Date.parse(incomingAt) > Date.parse(row.last_client_at ?? row.created_at)) {
        patch.last_client_at = incomingAt;
        if (["waiting", "scheduled"].includes(row.stage)) { patch.stage = row.assigned_to ? "working" : "new"; patch.next_followup_at = null; awakened++; }
      }
      if (row.source === "teletel" && c.teamId !== teamId && !row.send_lock) {
        patch.external_status = "transferred";
        patch.status = "done"; patch.stage = "transferred"; patch.done_at = now;
        patch.outcome = "transferred"; patch.note = "نُقلت المحادثة إلى قسم آخر في Teletel";
      }
      let query = db.from("sla_followups").update(patch).eq("id", row.id).eq("status", "open").eq("stage", row.stage);
      query = row.last_client_at ? query.eq("last_client_at", row.last_client_at) : query.is("last_client_at", null);
      query = row.last_attempt_at ? query.eq("last_attempt_at", row.last_attempt_at) : query.is("last_attempt_at", null);
      // A staff action / pending send wins over this snapshot.
      if (patch.stage) query = query.is("send_lock", null);
      const { error: updateError } = await query;
      if (updateError) throw new Error("followup sync update failed");
    }
  }
  const openIds = new Set(fetched.rows.map((c) => c.id));
  for (const row of rows.filter((r) => r.status === "open" && !openIds.has(r.conversation_id)).sort((a, b) => Date.parse(a.last_synced_at ?? a.created_at) - Date.parse(b.last_synced_at ?? b.created_at)).slice(0, 25)) {
    const conversation = await teletelGet<{ status?: string }>(`/conversations/${row.conversation_id}`);
    if (conversation) await db.from("sla_followups").update({ external_status: conversation.status ?? "unknown", last_synced_at: now }).eq("id", row.id);
  }
  return { added, awakened, scanned: fetched.rows.length };
}

/** Authenticated incoming webhook; the database serializes it with staff work. */
export async function wakeFollowup(conversationId: number, at: number) {
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0 || !Number.isFinite(at)) return;
  const { error } = await followupDb().rpc("followup_wake", { p_conversation: conversationId, p_at: new Date(at * 1000).toISOString() });
  if (error) throw new Error("followup wake failed");
}
