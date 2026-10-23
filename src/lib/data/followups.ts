"use server";

import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "./metrics";
import { logAudit } from "./audit";
import { conversationThread, teletelGet, listTeletelTeams, listOpenConversations, sendTeletelMessage, sendTeletelTemplate, teletelConversationUrl, whatsappTemplateStatus } from "@/lib/providers/teletel";
import { agentEmployees, enrollFollowup, followupRows, followupDb, followupPeople, followupTeamId, syncFollowups } from "@/lib/followups/service";
import { summarize } from "@/lib/followups/summary";
import {
  CLOSE_REASONS, FOLLOWUP_SETTINGS_KEY, mayAct, mayRead, parseFollowupSettings, STEP_TEMPLATE, stepFor, tomorrowAtTen, validateResult, WORK_COLS,
  type Attempt, type FollowupAccess, type FollowupSettings, type WorkResult, type WorkRow,
} from "@/lib/followups/rules";
import { WA_TEMPLATES, waPreview } from "@/lib/operations/client-messages";
import { recordCronRun } from "./cron-runs";

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const listTeletelAgents = async () => (await teletelGet<{ id: number; name: string }[]>("/agents")) ?? [];
async function readSettings(): Promise<FollowupSettings> {
  const { data } = await followupDb().from("app_settings").select("value").eq("key", FOLLOWUP_SETTINGS_KEY).maybeSingle();
  return parseFollowupSettings(data?.value);
}
/** The follow-up team and its managers; a seller (offers.write) for his own offers' files only; the one named for day seven. */
async function access(): Promise<FollowupAccess | null> {
  const [employeeId, work, manage, admin, developer, seller, settings] = await Promise.all([
    getCurrentEmployeeId(), currentCan("followups.work"), currentCan("followups.manage"), currentCan("dashboard.admin"), currentCan("developer.access"), currentCan("offers.write"), readSettings(),
  ]);
  const manager = manage || admin || developer;
  const closer = settings.closer === "employee" && settings.closerId === employeeId;
  return employeeId && (manager || work || seller || closer) ? { employeeId, manager, claim: manager || work, closer } : null;
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
  if (["assign", "assign_available", "release_uncertain", "restart"].includes(operation) && !f.who.manager) return { ok: false, error: "forbidden" };
  if (operation === "assign_available") {
    const result = await followupDb().rpc("followup_assign_available", { p_id: id, p_actor: f.who.employeeId, p_target: data.employeeId });
    return result.error ? { ok: false, error: "failed" } : result.data as WorkResult;
  }
  const result = await followupDb().rpc("followup_action", { p_id: id, p_actor: f.who.employeeId, p_action: operation, p_data: data });
  return result.error ? { ok: false, error: "failed" } : result.data as WorkResult;
}
const TEMPLATE_NAMES = Object.values(STEP_TEMPLATE).map((t) => WA_TEMPLATES[t.key].name);
export async function getFollowupWorkspace() {
  const who = await access();
  if (!who) return null;
  const db = followupDb();
  const [{ data }, people, settings, { data: heartbeat }] = await Promise.all([
    followupRows((a, b) => {
      let query = db.from("sla_followups").select(WORK_COLS);
      if (!who.manager) {
        const mine = [`assigned_to.eq.${who.employeeId}`, ...(who.claim ? ["and(assigned_to.is.null,status.eq.open)"] : []), ...(who.closer ? ["step.gte.3"] : [])];
        query = query.or(mine.join(","));
      }
      return query.order("request_started_at", { ascending: false }).order("id").range(a, b);
    }),
    followupPeople(), readSettings(),
    db.from("app_settings").select("value").eq("key", "cron_last_run:followups_sync").maybeSingle(),
  ]);
  const rows = (data ?? []) as WorkRow[];
  let attempts: (Pick<Attempt, "employee_id" | "kind" | "outcome" | "delivery_state" | "created_at"> & { followup_id: string })[] = [];
  let bookings: { followup_id: string; serial: string; total: number | null }[] = [];
  let templates: Record<string, string> | null = null;
  if (who.manager) {
    const weekAgo = new Date(Date.now() - 8 * 864e5).toISOString();
    const [result, confirmed, status] = await Promise.all([
      followupRows((a, b) => db.from("followup_attempts").select("followup_id,employee_id,kind,outcome,delivery_state,created_at").gte("created_at", weekAgo).order("id").range(a, b)),
      db.rpc("followup_confirmed_bookings"),
      whatsappTemplateStatus(),
    ]);
    attempts = result.data ?? [];
    if (confirmed.error) throw new Error("تعذر تحميل الحجوزات المؤكدة");
    const serials = ((confirmed.data ?? []) as { followup_id: string; serial: string }[]);
    const { data: totals } = serials.length ? await db.from("offers").select("serial,total_sar").in("serial", serials.map((s) => s.serial)) : { data: [] };
    const sar = new Map(((totals ?? []) as { serial: string; total_sar: number | null }[]).map((t) => [t.serial, t.total_sar]));
    bookings = serials.map((s) => ({ ...s, total: sar.get(s.serial) ?? null }));
    templates = status ? Object.fromEntries(TEMPLATE_NAMES.map((n) => [n, status.get(n) ?? "NONE"])) : null;
  }
  let lastSync: { at: string; ok: boolean } | null = null;
  try { lastSync = heartbeat ? JSON.parse(heartbeat.value) : null; } catch { /* unknown */ }
  return {
    ...who, canManageTeam: await currentCan("employees.manage"), rows, settings, templates, attempts, lastSync, confirmed: bookings,
    people: people.map(({ id, name, seller }) => ({ id, name, seller })),
  };
}
export type FollowupWorkspaceData = NonNullable<Awaited<ReturnType<typeof getFollowupWorkspace>>>;

/** The badge: files needing a hand now — the client wrote back, a step is due, or (the team) nobody has it yet. */
export async function getFollowupCount(): Promise<number> {
  const who = await access();
  if (!who) return 0;
  const db = followupDb();
  const base = () => {
    const q = db.from("sla_followups").select("id", { count: "exact", head: true }).eq("status", "open").neq("source", "sla");
    return who.manager ? q : q.eq("assigned_to", who.employeeId);
  };
  // disjoint: an unassigned file, or an assigned one whose client wrote back, or one due now
  const [unassigned, mine] = await Promise.all([
    who.claim ? db.from("sla_followups").select("id", { count: "exact", head: true }).eq("status", "open").is("assigned_to", null).neq("source", "sla") : Promise.resolve({ count: 0, error: null }),
    base().not("assigned_to", "is", null).or(`client_waiting.eq.true,next_followup_at.lte.${new Date().toISOString()}`),
  ]);
  if (unassigned.error || mine.error) throw new Error("followup count unavailable");
  return (unassigned.count ?? 0) + (mine.count ?? 0);
}

export async function getWorkDetail(id: string, pages = 2) {
  const f = await visible(id);
  if (!f) return null;
  const db = followupDb();
  const step = f.row.step ?? 0;
  const tpl = f.row.source === "visa" ? null : STEP_TEMPLATE[step] ?? null;
  const [thread, { data: attempts }, { data: lead }, canOffer, status] = await Promise.all([
    conversationThread(f.row.conversation_id, Math.max(1, Math.min(50, Math.floor(pages) || 2))),
    followupRows((a, b) => db.from("followup_attempts").select("id,employee_id,kind,outcome,note,due_at,provider_message_id,delivery_state,created_at").eq("followup_id", id).order("created_at", { ascending: false }).order("id").range(a, b)),
    db.from("client_leads").select("destination,inquiry,draft_id").eq("teletel_conversation_id", f.row.conversation_id).maybeSingle(),
    currentCan("offers.write"),
    tpl ? whatsappTemplateStatus() : Promise.resolve(null),
  ]);
  // the Basic file of the offer followed, else the lead's
  let draftId: string | null = lead?.draft_id ?? null;
  if (f.row.offer_id) {
    const { data: offer } = await db.from("offers").select("serial").eq("id", f.row.offer_id).maybeSingle();
    const { data: draft } = offer ? await db.from("offer_drafts").select("id").eq("data->>produced_serial", offer.serial).limit(1).maybeSingle() : { data: null };
    draftId = draft?.id ?? draftId;
  }
  // Recheck ownership after network I/O; a reassignment revokes the old viewer.
  if (!(await visible(id))) return null;
  return { row: f.row, messages: thread?.messages.filter((m) => !m.isPrivate) ?? null, canReply: thread?.canReply ?? false,
    historyComplete: thread?.historyComplete ?? false, attempts: (attempts ?? []) as Attempt[],
    destination: f.row.destination ?? f.row.summary?.destination ?? lead?.destination ?? null, inquiry: lead?.inquiry ?? null, draftId: canOffer ? draftId : null,
    teletelUrl: teletelConversationUrl(f.row.conversation_id),
    // outside the 24 hours the step goes as its approved template
    template: tpl ? { label: tpl.label, approved: status?.get(WA_TEMPLATES[tpl.key].name) === "APPROVED" } : null };
}
export type WorkDetail = NonNullable<Awaited<ReturnType<typeof getWorkDetail>>>;
export async function claimFollowup(id: string) { return action(id, "claim"); }
export async function assignWork(id: string, employeeId: string | null, onlyUnassigned = false) {
  if (employeeId && !uuid(employeeId)) return { ok: false, error: "invalid" } as WorkResult;
  return action(id, onlyUnassigned ? "assign_available" : "assign", { employeeId });
}
/**
 * «ماذا حدث؟» — one press, the next date set by itself: «لم يرد» does the step;
 * «مهتم» and «يريد تعديل» come back tomorrow at 10:00 (the alternative offer,
 * once sent, restarts the steps — service.ts); closing needs a reason.
 */
export async function recordFollowupResult(id: string, input: { outcome: string; dueAt: string | null; note: string; channel: string; reason?: string | null }): Promise<WorkResult> {
  const error = validateResult(input.outcome, input.dueAt, input.note, input.reason ?? null);
  if (error || !["call", "note", "message"].includes(input.channel)) return { ok: false, error: error ?? "invalid" };
  const dueAt = input.dueAt ?? (["interested", "revise_offer"].includes(input.outcome) ? tomorrowAtTen() : null);
  return action(id, "result", { ...input, dueAt, reason: input.reason ?? null, note: input.note.slice(0, 2000) });
}
/**
 * «أرسل للعميل»: free text inside WhatsApp's 24 hours; outside them the
 * step's approved template (days 1, 3, 7), with the client's first name and
 * the destination — nothing else can reach him then.
 */
export async function sendFollowupReply(id: string, text: string, requestId: string): Promise<WorkResult> {
  const f = await visible(id, true);
  if (!f) return { ok: false, error: "forbidden" };
  if (!uuid(requestId) || text.length > 4000) return { ok: false, error: "invalid" };
  const thread = await conversationThread(f.row.conversation_id);
  if (!thread) return { ok: false, error: "unreachable" };
  let send: () => Promise<number | null>;
  let body = text.trim();
  if (thread.canReply) {
    if (!body) return { ok: false, error: "invalid" };
    send = () => sendTeletelMessage(f.row.conversation_id, body);
  } else {
    // a visa's follow-up has no template yet: a call
    const tpl = f.row.step !== null && !f.row.client_waiting && f.row.source !== "visa" ? STEP_TEMPLATE[f.row.step] : undefined;
    if (!tpl) return { ok: false, error: "window" };
    const def = WA_TEMPLATES[tpl.key];
    if ((await whatsappTemplateStatus())?.get(def.name) !== "APPROVED") return { ok: false, error: "template" };
    const destination = (f.row.destination ?? f.row.summary?.destination ?? "").trim();
    if (!destination) return { ok: false, error: "destination" };
    const params = [(f.row.contact_name ?? "").trim().split(/\s+/)[0] || "العزيز", destination];
    body = waPreview(def, params);
    send = () => sendTeletelTemplate(f.row.conversation_id, { name: def.name, params, preview: body, category: def.category });
  }
  const reserved = await action(id, "reserve_send", { requestId, text: body });
  if (!reserved.ok || reserved.duplicate) return reserved;
  const messageId = await send();
  const finished = await action(id, "finish_send", { requestId, state: messageId === null ? "uncertain" : "sent", messageId });
  if (!finished.ok) return finished;
  return messageId === null ? { ok: false, error: "uncertain" } : { ok: true };
}
/** «اقتراح آخر من مُراد»: the summary and the draft made again now. */
export async function remakeSummary(id: string): Promise<WorkResult> {
  const f = await visible(id, true);
  if (!f) return { ok: false, error: "forbidden" };
  return (await summarize(f.row).catch(() => null)) ? { ok: true } : { ok: false, error: "murad" };
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

// ---------- «مراجعة قبل الأرشفة» (managers): the owner decides, row by row or a group at once ----------

const manyIds = (ids: string[]) => Array.isArray(ids) && ids.length > 0 && ids.length <= 300 && ids.every(uuid);
async function each(ids: string[], work: (id: string) => Promise<WorkResult>): Promise<WorkResult & { done?: number }> {
  if (!(await access())?.manager) return { ok: false, error: "forbidden" };
  if (!manyIds(ids)) return { ok: false, error: "invalid" };
  let done = 0;
  for (const id of ids) if ((await work(id)).ok) done++;
  return { ok: true, done } as WorkResult & { done: number };
}
/** «أرشف»: closed as «لم يكمل» with its reason — nothing is archived by itself. */
export async function archiveFollowups(ids: string[], reason: string) {
  if (!(CLOSE_REASONS as readonly string[]).includes(reason)) return { ok: false, error: "reason" } as WorkResult;
  return each(ids, (id) => action(id, "result", { outcome: "not_completed", reason, note: "أرشفة بعد المراجعة", channel: "note", dueAt: null }));
}
/** «أعد للمتابعة» / «أدخلها في الخطوات»: the steps from the file's last interaction, due now. */
export async function restartFollowups(ids: string[]) {
  return each(ids, async (id) => {
    const f = await visible(id, true);
    if (!f) return { ok: false, error: "forbidden" };
    const from = Date.parse(f.row.offer_at ?? f.row.last_attempt_at ?? f.row.last_client_at ?? f.row.request_started_at);
    return action(id, "restart", { step: stepFor(from, Date.now()), offerAt: new Date(from).toISOString(), dueAt: new Date(Date.now() + 60_000).toISOString() });
  });
}
/** «وزّع على المبيعات»: each to the seller holding the conversation in Teletel, else in turn among the sellers. */
export async function distributeFollowups(ids: string[]) {
  const [people, open, { data }] = await Promise.all([
    followupPeople(), listOpenConversations(),
    manyIds(ids) ? followupDb().from("sla_followups").select("id,conversation_id").in("id", ids) : Promise.resolve({ data: [] }),
  ]);
  const byAgent = await agentEmployees(people);
  const sellers = people.filter((p) => p.seller && p.agentId);
  const holder = new Map((open?.rows ?? []).map((c) => [c.id, byAgent(c.assigneeId)]));
  const convOf = new Map(((data ?? []) as { id: string; conversation_id: number }[]).map((r) => [r.id, r.conversation_id]));
  let turn = 0;
  return each(ids, (id) => {
    const target = holder.get(convOf.get(id) ?? -1) ?? sellers[turn++ % Math.max(1, sellers.length)]?.id ?? null;
    return target ? action(id, "assign", { employeeId: target }) : Promise.resolve({ ok: false, error: "invalid" } as WorkResult);
  });
}
export async function saveFollowupPageSettings(next: FollowupSettings): Promise<WorkResult> {
  if (!(await access())?.manager) return { ok: false, error: "forbidden" };
  const clean = parseFollowupSettings(JSON.stringify(next));
  if (clean.closer === "employee" && !(clean.closerId && (await followupPeople()).some((p) => p.id === clean.closerId))) return { ok: false, error: "invalid" };
  const { error } = await followupDb().from("app_settings").upsert({ key: FOLLOWUP_SETTINGS_KEY, value: JSON.stringify(clean), updated_at: new Date().toISOString() });
  if (!error) await logAudit({ action: "data.updated", entity: "followup_settings", entity_id: FOLLOWUP_SETTINGS_KEY, meta: clean });
  return error ? { ok: false, error: "failed" } : { ok: true };
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
