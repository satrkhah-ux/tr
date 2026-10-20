"use server";

import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "./metrics";
import { logAudit } from "./audit";
import { conversationThread, teletelGet, listTeletelTeams, listOpenConversations, sendTeletelMessage, assignTeletelTeam } from "@/lib/providers/teletel";
import { enrollFollowup, followupRows, followupDb, followupPeople, followupTeamId, syncFollowups } from "@/lib/followups/service";
import { mayAct, mayRead, validateResult, WORK_COLS, type Attempt, type FollowupAccess, type WorkResult, type WorkRow } from "@/lib/followups/rules";
import { recordCronRun } from "./cron-runs";

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const listTeletelAgents = async () => (await teletelGet<{ id: number; name: string }[]>("/agents")) ?? [];
async function access(): Promise<FollowupAccess | null> {
  const [employeeId, work, manage, admin, developer] = await Promise.all([
    getCurrentEmployeeId(), currentCan("followups.work"), currentCan("followups.manage"), currentCan("dashboard.admin"), currentCan("developer.access"),
  ]);
  const manager = manage || admin || developer;
  return employeeId && (manager || work) ? { employeeId, manager } : null;
}
async function visible(id: string, act = false) {
  const who = await access();
  if (!who || !uuid(id)) return null;
  const { data, error } = await followupDb().from("sla_followups").select(WORK_COLS).eq("id", id).maybeSingle();
  const row = data as WorkRow | null;
  if (error || !row || !(act ? mayAct(row, who) : mayRead(row, who))) return null;
  return { who, row };
}
async function action(id: string, operation: string, data: Record<string, unknown> = {}): Promise<WorkResult> {
  const f = await visible(id, operation !== "claim");
  if (!f) return { ok: false, error: "forbidden" };
  if (["assign", "assign_available", "release_uncertain"].includes(operation) && !f.who.manager) return { ok: false, error: "forbidden" };
  if (operation === "assign_available") {
    const result = await followupDb().rpc("followup_assign_available", { p_id: id, p_actor: f.who.employeeId, p_target: data.employeeId });
    return result.error ? { ok: false, error: "failed" } : result.data as WorkResult;
  }
  const result = await followupDb().rpc("followup_action", { p_id: id, p_actor: f.who.employeeId, p_action: operation, p_data: data });
  return result.error ? { ok: false, error: "failed" } : result.data as WorkResult;
}
export async function getFollowupWorkspace() {
  const who = await access();
  if (!who) return null;
  const db = followupDb();
  const [{ data }, people, teams, { data: heartbeat }] = await Promise.all([
    followupRows((a, b) => {
      let query = db.from("sla_followups").select(WORK_COLS);
      if (!who.manager) query = query.or(`assigned_to.eq.${who.employeeId},and(assigned_to.is.null,status.eq.open)`);
      return query.order("request_started_at", { ascending: false }).order("id").range(a, b);
    }),
    followupPeople(), listTeletelTeams(),
    db.from("app_settings").select("value").eq("key", "cron_last_run:followups_sync").maybeSingle(),
  ]);
  const rows = (data ?? []) as WorkRow[];
  let attempts: Pick<Attempt, "employee_id" | "kind" | "outcome" | "delivery_state" | "created_at">[] = [];
  if (who.manager) {
    // Full pagination: reports do not silently stop at 1,000 attempts.
    const result = await followupRows((a, b) => db.from("followup_attempts").select("employee_id,kind,outcome,delivery_state,created_at").order("id").range(a, b));
    attempts = result.data ?? [];
  }
  const bookings = who.manager ? await db.rpc("followup_confirmed_bookings") : null;
  if (bookings?.error) throw new Error("تعذر تحميل الحجوزات المؤكدة");
  let lastSync: { at: string; ok: boolean } | null = null;
  try { lastSync = heartbeat ? JSON.parse(heartbeat.value) : null; } catch { /* unknown */ }
  return { ...who, canManageTeam: await currentCan("employees.manage"), rows, people, teams, attempts, lastSync, confirmed: (bookings?.data ?? []) as { followup_id: string; serial: string }[] };
}
export type FollowupWorkspaceData = NonNullable<Awaited<ReturnType<typeof getFollowupWorkspace>>>;

export async function getFollowupCount(): Promise<number> {
  const who = await access();
  if (!who) return 0;
  const db = followupDb();
  // Unassigned and due are disjoint, so the badge counts each file once.
  const unassigned = await db.from("sla_followups").select("id", { count: "exact", head: true }).eq("status", "open").is("assigned_to", null);
  let due = db.from("sla_followups").select("id", { count: "exact", head: true }).eq("status", "open").not("assigned_to", "is", null).lte("next_followup_at", new Date().toISOString());
  if (!who.manager) due = due.eq("assigned_to", who.employeeId);
  const result = await due;
  if (unassigned.error || result.error) throw new Error("followup count unavailable");
  return (unassigned.count ?? 0) + (result.count ?? 0);
}

export async function getWorkDetail(id: string, pages = 2) {
  const f = await visible(id);
  if (!f) return null;
  const db = followupDb();
  const [thread, { data: attempts }, { data: lead }, canOffer] = await Promise.all([
    conversationThread(f.row.conversation_id, Math.max(1, Math.min(50, Math.floor(pages) || 2))),
    followupRows((a, b) => db.from("followup_attempts").select("id,employee_id,kind,outcome,note,due_at,provider_message_id,delivery_state,created_at").eq("followup_id", id).order("created_at", { ascending: false }).order("id").range(a, b)),
    db.from("client_leads").select("destination,inquiry,draft_id").eq("teletel_conversation_id", f.row.conversation_id).maybeSingle(),
    currentCan("offers.write"),
  ]);
  // Recheck ownership after network I/O; a reassignment revokes the old viewer.
  if (!(await visible(id))) return null;
  return { row: f.row, messages: thread?.messages.filter((m) => !m.isPrivate) ?? null, canReply: thread?.canReply ?? false,
    historyComplete: thread?.historyComplete ?? false, attempts: (attempts ?? []) as Attempt[],
    destination: lead?.destination ?? null, inquiry: lead?.inquiry ?? null, draftId: canOffer ? lead?.draft_id ?? null : null };
}
export type WorkDetail = NonNullable<Awaited<ReturnType<typeof getWorkDetail>>>;
export async function claimFollowup(id: string) { return action(id, "claim"); }
export async function assignWork(id: string, employeeId: string | null, onlyUnassigned = false) {
  if (employeeId && !uuid(employeeId)) return { ok: false, error: "invalid" } as WorkResult;
  return action(id, onlyUnassigned ? "assign_available" : "assign", { employeeId });
}
export async function recordFollowupResult(id: string, input: { outcome: string; dueAt: string | null; note: string; channel: string }): Promise<WorkResult> {
  const error = validateResult(input.outcome, input.dueAt, input.note);
  if (error || input.outcome === "transferred" || !["call", "note", "message"].includes(input.channel)) return { ok: false, error: error ?? "invalid" };
  return action(id, "result", { ...input, note: input.note.slice(0, 2000) });
}
export async function sendFollowupReply(id: string, text: string, requestId: string): Promise<WorkResult> {
  const f = await visible(id, true);
  if (!f) return { ok: false, error: "forbidden" };
  if (!uuid(requestId) || !text.trim() || text.length > 4000) return { ok: false, error: "invalid" };
  const thread = await conversationThread(f.row.conversation_id);
  if (!thread) return { ok: false, error: "unreachable" };
  if (!thread.canReply) return { ok: false, error: "window" };
  const reserved = await action(id, "reserve_send", { requestId, text: text.trim() });
  if (!reserved.ok || reserved.duplicate) return reserved;
  const messageId = await sendTeletelMessage(f.row.conversation_id, text.trim());
  const finished = await action(id, "finish_send", { requestId, state: messageId === null ? "uncertain" : "sent", messageId });
  if (!finished.ok) return finished;
  return messageId === null ? { ok: false, error: "uncertain" } : { ok: true };
}
export async function reviewFollowupSend(id: string, confirmNotSent = false, note = ""): Promise<WorkResult> {
  const f = await visible(id, true);
  if (!f || !f.row.send_lock) return { ok: false, error: "forbidden" };
  const { data: attempt } = await followupDb().from("followup_attempts").select("id,note,created_at,kind,target_team_id").eq("id", f.row.send_lock).single();
  if (!attempt) return { ok: false, error: "failed" };
  if (confirmNotSent) return action(id, "release_uncertain", { note });
  if (attempt.kind === "transfer") {
    const conversation = await teletelGet<{ meta?: { team?: { id?: number } } }>(`/conversations/${f.row.conversation_id}`);
    if (conversation?.meta?.team?.id !== attempt.target_team_id) return { ok: false, error: "uncertain" };
    return action(id, "finish_transfer", { requestId: attempt.id, state: "sent", messageId: null });
  }
  if (attempt.kind !== "message") return { ok: false, error: "uncertain" };
  const thread = await conversationThread(f.row.conversation_id, 10, Date.parse(attempt.created_at) / 1000 - 5);
  if (!thread) return { ok: false, error: "unreachable" };
  const matches = thread.messages.filter((m) => !m.fromClient && !m.isPrivate && m.text === attempt.note && m.at >= Date.parse(attempt.created_at) / 1000 - 2);
  if (matches.length !== 1) return { ok: false, error: "uncertain" };
  return action(id, "finish_send", { requestId: attempt.id, state: "sent", messageId: matches[0].id });
}
export async function transferFollowup(id: string, teamId: number, note: string, requestId: string): Promise<WorkResult> {
  const f = await visible(id, true);
  if (!f) return { ok: false, error: "forbidden" };
  const teams = await listTeletelTeams();
  const team = teams.find((t) => t.id === teamId);
  if (!team || teamId === await followupTeamId() || note.trim().length < 3 || !uuid(requestId)) return { ok: false, error: "invalid" };
  const reserved = await action(id, "reserve_transfer", { requestId, targetTeamId: teamId, text: `${team.name}: ${note.trim()}` });
  if (!reserved.ok || reserved.duplicate) return reserved;
  const sent = await assignTeletelTeam(f.row.conversation_id, teamId);
  const result = await action(id, "finish_transfer", { requestId, state: sent ? "sent" : "uncertain", messageId: null });
  return sent ? result : { ok: false, error: "uncertain" };
}
export async function transferClientToFollowup(conversationId: number, reason: string): Promise<WorkResult> {
  const [who, clients, employee] = await Promise.all([access(), currentCan("clients.view"), getCurrentEmployeeId()]);
  if (!employee || (!who?.manager && !clients)) return { ok: false, error: "forbidden" };
  if (!Number.isSafeInteger(conversationId) || reason.trim().length < 3) return { ok: false, error: "invalid" };
  const c = (await listOpenConversations(true))?.rows.find((r) => r.id === conversationId);
  if (!c) return { ok: false, error: "unreachable" };
  // Internal transfer into the work queue; no customer message is sent.
  return { ok: true, id: await enrollFollowup(c, "manual", reason.trim().slice(0, 500), employee) };
}
export async function refreshFollowupSync(): Promise<WorkResult> {
  if (!(await access())?.manager) return { ok: false, error: "forbidden" };
  try { await recordCronRun("followups_sync", syncFollowups); return { ok: true }; }
  catch { return { ok: false, error: "unreachable" }; }
}
export async function getFollowupSettings() {
  if (!(await currentCan("employees.manage"))) return null;
  const [teamId, teams, agents, people, { data: mappings }] = await Promise.all([
    followupTeamId(), listTeletelTeams(), listTeletelAgents(), followupPeople(), followupDb().from("followup_agent_map").select("agent_id,employee_id"),
  ]);
  return { teamId, teams, agents, people, mappings: (mappings ?? []) as { agent_id: number; employee_id: string }[] };
}
export async function saveFollowupMapping(agentId: number, employeeId: string | null): Promise<WorkResult> {
  if (!(await currentCan("employees.manage"))) return { ok: false, error: "forbidden" };
  if (!(await listTeletelAgents()).some((a) => a.id === agentId)) return { ok: false, error: "invalid" };
  if (employeeId && !(await followupPeople()).some((p) => p.id === employeeId)) return { ok: false, error: "invalid" };
  const query = employeeId ? followupDb().from("followup_agent_map").upsert({ agent_id: agentId, employee_id: employeeId }) : followupDb().from("followup_agent_map").delete().eq("agent_id", agentId);
  const { error } = await query;
  if (!error) await logAudit({ action: "data.updated", entity: "followup_settings", entity_id: String(agentId), meta: { employeeId } });
  return error ? { ok: false, error: "failed" } : { ok: true };
}
export async function saveFollowupTeam(teamId: number): Promise<WorkResult> {
  if (!(await currentCan("employees.manage"))) return { ok: false, error: "forbidden" };
  if (!(await listTeletelTeams()).some((t) => t.id === teamId)) return { ok: false, error: "invalid" };
  const { error } = await followupDb().from("app_settings").upsert({ key: "followup_team_id", value: String(teamId), updated_at: new Date().toISOString() });
  if (!error) await logAudit({ action: "data.updated", entity: "followup_settings", entity_id: "followup_team_id", meta: { teamId } });
  return error ? { ok: false, error: "failed" } : { ok: true };
}
