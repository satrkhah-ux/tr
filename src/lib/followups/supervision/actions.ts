"use server";

import { logAudit } from "@/lib/data/audit";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { currentCan } from "@/lib/roles/current";
import { notifyEmployee } from "@/lib/notifications/notify";
import { teletelConversationUrl } from "@/lib/providers/teletel";
import { followupPeople } from "@/lib/followups/service";
import { reassignConversation } from "@/lib/routing/switchboard";
import {
  addBusinessMinutes, businessMinutes, detect, employeeReport, parseSupervisionSettings, proofOf, REASON_LABEL, supervisorReport,
  SUPERVISION_SETTINGS_KEY, type Level, type Priority, type ProofKind, type Reason, type ReportCase, type SupervisionSettings, type SupervisorRow,
} from "./core";
import { availableEmployees, readFacts, readSupervisionSettings, readSupervisors, supervisionDb, teamsOfEmployees } from "./data";

/**
 * «إشراف المتابعة» — what the screen reads and what a supervisor does. Who sees
 * what: an employee their own cases, a supervisor their scope, the management
 * everyone. Every change lands in audit_logs with who, when, old/new and why.
 * The supervisor never takes the conversation: reassigning moves the follow-up
 * file to an AVAILABLE colleague, and closing a case needs a real act already
 * done (a message sent, a call logged, a reassignment, the client's reply).
 */

const UUID = /^[0-9a-f-]{36}$/i;
type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;
const fail = (error: string): Fail => ({ ok: false, error });

type Who = { me: string; manager: boolean; scopes: SupervisorRow[] };
async function who(): Promise<Who | null> {
  const [me, manage, admin, developer] = await Promise.all([getCurrentEmployeeId(), currentCan("followups.manage"), currentCan("dashboard.admin"), currentCan("developer.access")]);
  if (!me) return null;
  const all = (await readSupervisors(supervisionDb())) ?? [];
  return { me, manager: manage || admin || developer, scopes: all.filter((s) => s.supervisor_id === me && s.active) };
}

/** the employees a supervisor watches (null = everyone) */
async function scopeEmployees(w: Who): Promise<Set<string> | null> {
  if (w.manager || w.scopes.some((s) => s.scope_kind === "all")) return null;
  const ids = new Set(w.scopes.filter((s) => s.scope_kind === "employee").map((s) => s.scope_ref));
  const teams = w.scopes.filter((s) => s.scope_kind === "team").map((s) => Number(s.scope_ref));
  for (const [emp, t] of await teamsOfEmployees(supervisionDb(), teams)) if (t.some((x) => teams.includes(x))) ids.add(emp);
  return ids;
}

type CaseDb = {
  id: string; followup_id: string | null; conversation_id: number; employee_id: string | null; supervisor_id: string | null;
  reason: Reason; priority: Priority; level: Level; status: "open" | "closed"; detected_at: string; since_at: string | null;
  level_due_at: string | null; directive: string | null; directive_due_at: string | null; escalated_at: string | null;
  closed_at: string | null; close_note: string | null; proof_kind: ProofKind | null;
};
const CASE_COLS = "id,followup_id,conversation_id,employee_id,supervisor_id,reason,priority,level,status,detected_at,since_at,level_due_at,directive,directive_due_at,escalated_at,closed_at,close_note,proof_kind";

/** may this person see / act on the case */
async function caseFor(id: string, act: boolean): Promise<{ w: Who; c: CaseDb } | null> {
  const w = await who();
  if (!w || !UUID.test(id)) return null;
  const { data } = await supervisionDb().from("followup_supervision_cases").select(CASE_COLS).eq("id", id).maybeSingle();
  const c = data as CaseDb | null;
  if (!c) return null;
  if (w.manager) return { w, c };
  const scope = await scopeEmployees(w);
  const supervises = w.scopes.length > 0 && (c.supervisor_id === w.me || scope === null || (c.employee_id != null && scope.has(c.employee_id)));
  if (act) return supervises ? { w, c } : null;
  return supervises || c.employee_id === w.me ? { w, c } : null;
}

// ------------------------------------------------------------------ the board

export type BoardFilters = { employeeId?: string; supervisorId?: string; status?: "open" | "closed"; priority?: Priority; days?: number };
export type BoardRow = {
  id: string; conversationId: number; url: string | null; followupId: string | null;
  client: string; employeeId: string | null; employee: string; supervisorId: string | null; supervisor: string;
  lastClientLine: string | null; lastClientAt: string | null; lastActionAt: string | null; nextFollowupAt: string | null;
  delayMinutes: number; reason: Reason; reasonLabel: string; priority: Priority; level: Level; status: "open" | "closed";
  directive: string | null; directiveDueAt: string | null; proof: ProofKind | null; closeNote: string | null; detectedAt: string;
};
export type Board = { rows: BoardRow[]; manager: boolean; supervisor: boolean; me: string; people: { id: string; name: string }[]; enabled: boolean };

export async function getSupervisionBoard(filters: BoardFilters = {}): Promise<Board | null> {
  const w = await who();
  if (!w) return null;
  const db = supervisionDb();
  const supervisor = w.scopes.length > 0;
  let q = db.from("followup_supervision_cases").select(CASE_COLS).eq("status", filters.status ?? "open");
  if (filters.status === "closed") q = q.gte("closed_at", new Date(Date.now() - Math.min(Math.max(filters.days ?? 7, 1), 90) * 86_400_000).toISOString());
  if (filters.priority) q = q.eq("priority", filters.priority);
  if (filters.employeeId && UUID.test(filters.employeeId)) q = q.eq("employee_id", filters.employeeId);
  if (filters.supervisorId && UUID.test(filters.supervisorId)) q = q.eq("supervisor_id", filters.supervisorId);
  const { data, error } = await q.order("detected_at", { ascending: false }).limit(500);
  const people = (await followupPeople().catch(() => [])).filter((p) => p.person).map((p) => ({ id: p.id, name: p.name }));
  if (error) return { rows: [], manager: w.manager, supervisor, me: w.me, people, enabled: false };

  let cases = (data ?? []) as CaseDb[];
  if (!w.manager) {
    const scope = supervisor ? await scopeEmployees(w) : new Set<string>();
    cases = cases.filter((c) => c.employee_id === w.me || (supervisor && (c.supervisor_id === w.me || scope === null || (c.employee_id != null && scope.has(c.employee_id)))));
  }
  const ids = [...new Set(cases.map((c) => c.followup_id).filter((x): x is string => Boolean(x)))];
  const { data: fRows } = ids.length
    ? await db.from("sla_followups").select("id,contact_name,last_line,client_line,last_client_at,last_attempt_at,next_followup_at,last_by").in("id", ids)
    : { data: [] };
  const fu = new Map(((fRows ?? []) as { id: string; contact_name: string | null; last_line: string | null; client_line: string | null; last_client_at: string | null; last_attempt_at: string | null; next_followup_at: string | null; last_by: string | null }[]).map((r) => [r.id, r]));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const { hours, settings } = await readSupervisionSettings(db);
  const now = Date.now();
  const LEVEL_RANK: Record<Level, number> = { manager: 0, supervisor: 1, employee: 2 };
  const PRIO_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

  const rows: BoardRow[] = cases.map((c) => {
    const f = c.followup_id ? fu.get(c.followup_id) : undefined;
    return {
      id: c.id, conversationId: c.conversation_id, url: teletelConversationUrl(c.conversation_id), followupId: c.followup_id,
      client: f?.contact_name || `محادثة #${c.conversation_id}`,
      employeeId: c.employee_id, employee: (c.employee_id && nameOf.get(c.employee_id)) || "—",
      supervisorId: c.supervisor_id, supervisor: (c.supervisor_id && nameOf.get(c.supervisor_id)) || "—",
      lastClientLine: f?.client_line ?? (f?.last_by === "client" ? f?.last_line ?? null : null), lastClientAt: f?.last_client_at ?? null,
      lastActionAt: f?.last_attempt_at ?? null, nextFollowupAt: f?.next_followup_at ?? null,
      delayMinutes: businessMinutes(Date.parse(c.since_at ?? c.detected_at), c.closed_at ? Date.parse(c.closed_at) : now, hours, settings.holidays),
      reason: c.reason, reasonLabel: REASON_LABEL[c.reason], priority: c.priority, level: c.level, status: c.status,
      directive: c.directive, directiveDueAt: c.directive_due_at, proof: c.proof_kind, closeNote: c.close_note, detectedAt: c.detected_at,
    };
  }).sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || b.delayMinutes - a.delayMinutes);
  return { rows, manager: w.manager, supervisor, me: w.me, people, enabled: true };
}

// ------------------------------------------------------------------ supervisor actions

const nowIso = () => new Date().toISOString();

/** «توجيه»: an internal instruction to the employee with a due time (working minutes) */
export async function directCase(id: string, note: string, dueMinutes: number): Promise<Ok | Fail> {
  const x = await caseFor(id, true);
  if (!x || x.c.status !== "open") return fail("forbidden");
  const text = (note ?? "").trim().slice(0, 1000);
  if (text.length < 3 || !Number.isFinite(dueMinutes) || dueMinutes < 5 || dueMinutes > 7 * 24 * 60) return fail("اكتب التوجيه ومهلة بين 5 دقائق و7 أيام.");
  const { hours, settings } = await readSupervisionSettings(supervisionDb());
  const due = addBusinessMinutes(Date.now(), dueMinutes, hours, settings.holidays);
  const dueIso = due ? new Date(due).toISOString() : null;
  const { error } = await supervisionDb().from("followup_supervision_cases")
    .update({ directive: text, directive_due_at: dueIso, level: x.c.level === "employee" ? "supervisor" : x.c.level, supervisor_id: x.c.supervisor_id ?? x.w.me, updated_at: nowIso() })
    .eq("id", id).eq("status", "open");
  if (error) return fail("تعذّر الحفظ.");
  await logAudit({ action: "supervision.directed", entity: "followup_supervision_cases", entity_id: id, meta: { old: { directive: x.c.directive, due: x.c.directive_due_at }, new: { directive: text, due: dueIso } } });
  if (x.c.employee_id) await notifyEmployee({ employeeId: x.c.employee_id, kind: "supervision", source: "followups", href: "/followups/supervision", title: `📌 توجيه من المشرف — محادثة #${x.c.conversation_id}`, body: text, dedupeKey: `sup:${id}:directive:${dueIso}` }).catch(() => null);
  return { ok: true };
}

/** «إعادة جدولة»: the follow-up's next time moves, with the reason, in the follow-up's own history */
export async function rescheduleCase(id: string, dueAt: string, reason: string): Promise<Ok | Fail> {
  const x = await caseFor(id, true);
  if (!x || x.c.status !== "open" || !x.c.followup_id) return fail("forbidden");
  const why = (reason ?? "").trim().slice(0, 500);
  const due = Date.parse(dueAt);
  if (why.length < 3 || !Number.isFinite(due) || due <= Date.now() || due > Date.now() + 60 * 86_400_000) return fail("اختر موعداً قادماً واكتب السبب.");
  const db = supervisionDb();
  const { data: before } = await db.from("sla_followups").select("next_followup_at").eq("id", x.c.followup_id).maybeSingle();
  const iso = new Date(due).toISOString();
  const { error } = await db.from("sla_followups").update({ next_followup_at: iso, stage: "scheduled" }).eq("id", x.c.followup_id).eq("status", "open");
  if (error) return fail("تعذّر الحفظ.");
  await db.from("followup_attempts").insert({ followup_id: x.c.followup_id, employee_id: x.w.me, kind: "note", note: `إعادة جدولة من المشرف: ${why}`, due_at: iso });
  await logAudit({ action: "supervision.rescheduled", entity: "sla_followups", entity_id: x.c.followup_id, meta: { case: id, old: (before as { next_followup_at: string | null } | null)?.next_followup_at ?? null, new: iso, reason: why } });
  return { ok: true };
}

/**
 * «إعادة إسناد»: to an AVAILABLE colleague, with the reason — the Teletel conversation through session B's switchboard
 * first (it refuses a conversation with a sale or a confirmed service unless an administrator forces it), then the
 * follow-up file. Nothing moves if Teletel refuses.
 */
export async function reassignCase(id: string, toEmployeeId: string, reason: string, force = false): Promise<Ok | Fail> {
  const x = await caseFor(id, true);
  if (!x || x.c.status !== "open" || !x.c.followup_id || !UUID.test(toEmployeeId)) return fail("forbidden");
  const why = (reason ?? "").trim().slice(0, 500);
  if (why.length < 3) return fail("اكتب سبب إعادة الإسناد.");
  if (toEmployeeId === x.c.employee_id) return fail("هو الموظف نفسه.");
  const db = supervisionDb();
  const people = await followupPeople().catch(() => []);
  if (!people.some((p) => p.id === toEmployeeId && p.person)) return fail("هذا الموظف لا يعمل على المتابعة.");
  if (!(await availableEmployees(db, Date.now(), [toEmployeeId])).has(toEmployeeId)) return fail("الموظف غير متاح الآن — اختر من هو على رأس العمل.");
  const { data: me } = await db.from("employees").select("arabic_name").eq("id", x.w.me).maybeSingle();
  const actorName = ((me as { arabic_name?: string } | null)?.arabic_name ?? "المشرف").trim();
  const moved = await reassignConversation(x.c.conversation_id, toEmployeeId, why, { id: x.w.me, name: actorName, admin: x.w.manager }, { force: force && x.w.manager });
  if (!moved.ok) return fail(moved.error);
  const { error } = await db.from("sla_followups")
    .update({ assigned_to: toEmployeeId, assigned_by: x.w.me, assigned_at: nowIso() })
    .eq("id", x.c.followup_id).eq("status", "open");
  if (error) return fail("تعذّر الحفظ.");
  await db.from("followup_attempts").insert({ followup_id: x.c.followup_id, employee_id: x.w.me, kind: "assign", note: `${toEmployeeId} — ${why}` });
  await logAudit({ action: "supervision.reassigned", entity: "sla_followups", entity_id: x.c.followup_id, meta: { case: id, old: x.c.employee_id, new: toEmployeeId, reason: why } });
  await notifyEmployee({ employeeId: toEmployeeId, kind: "supervision", source: "followups", href: x.c.followup_id ? `/followups/${x.c.followup_id}` : "/followups", title: `📥 أُسند إليك عميل — محادثة #${x.c.conversation_id}`, body: why, dedupeKey: `sup:${id}:to:${toEmployeeId}` }).catch(() => null);
  return { ok: true };
}

/** «تصعيد للمدير» */
export async function escalateCase(id: string, note: string): Promise<Ok | Fail> {
  const x = await caseFor(id, true);
  if (!x || x.c.status !== "open") return fail("forbidden");
  if (x.c.level === "manager") return fail("الحالة عند الإدارة أصلاً.");
  const text = (note ?? "").trim().slice(0, 1000);
  if (text.length < 3) return fail("اكتب سبب التصعيد.");
  const { error } = await supervisionDb().from("followup_supervision_cases").update({ level: "manager", escalated_at: nowIso(), level_due_at: null, updated_at: nowIso() }).eq("id", id).eq("status", "open");
  if (error) return fail("تعذّر الحفظ.");
  await logAudit({ action: "supervision.escalated", entity: "followup_supervision_cases", entity_id: id, meta: { old: x.c.level, new: "manager", reason: text } });
  await notifyEmployee({ permission: "followups.manage", kind: "supervision", source: "followups", href: "/followups/supervision", title: `🚨 تصعيد من المشرف — محادثة #${x.c.conversation_id}`, body: text, dedupeKey: `sup:${id}:manager` }).catch(() => null);
  return { ok: true };
}

/**
 * «إغلاق حالة الإشراف»: only on a REAL act already in the data (proofOf), with
 * a note of what was done — the client's conversation is never closed here.
 */
export async function closeCase(id: string, note: string): Promise<Ok<{ proof: ProofKind }> | Fail> {
  const x = await caseFor(id, true);
  if (!x || x.c.status !== "open") return fail("forbidden");
  const text = (note ?? "").trim().slice(0, 1000);
  if (text.length < 3) return fail("وثّق ما عُولج قبل الإغلاق.");
  const db = supervisionDb();
  const { settings, hours } = await readSupervisionSettings(db);
  const { facts } = x.c.followup_id ? await readFacts(db, [x.c.followup_id]) : { facts: [] };
  const f = facts[0] ?? null;
  const { data: att } = x.c.followup_id
    ? await db.from("followup_attempts").select("kind,outcome,delivery_state").eq("followup_id", x.c.followup_id).gte("created_at", x.c.detected_at).limit(200)
    : { data: [] };
  const proof = proofOf({
    reason: x.c.reason,
    detectedMs: Date.parse(x.c.detected_at),
    stillFound: Boolean(f && detect(f, settings, hours, Date.now()).some((d) => d.reason === x.c.reason)),
    facts: f,
    caseEmployeeId: x.c.employee_id,
    attemptsSince: ((att ?? []) as { kind: string; outcome: string | null; delivery_state: string }[]).map((a) => ({ kind: a.kind, outcome: a.outcome, delivered: a.delivery_state === "sent" })),
  });
  if (!proof) return fail("لا يوجد فعل حقيقي بعد — أرسل رسالة، أو وثّق مكالمة بنتيجتها، أو أعد الإسناد، ثم أغلق.");
  const { error } = await db.from("followup_supervision_cases").update({ status: "closed", closed_at: nowIso(), closed_by: x.w.me, close_note: text, proof_kind: proof, updated_at: nowIso() }).eq("id", id).eq("status", "open");
  if (error) return fail("تعذّر الحفظ.");
  await logAudit({ action: "supervision.case_closed", entity: "followup_supervision_cases", entity_id: id, meta: { proof, note: text, by: "supervisor" } });
  return { ok: true, proof };
}

// ------------------------------------------------------------------ supervisors & settings (management)

export type SupervisorEntry = SupervisorRow & { id: string; name: string };

export async function listSupervisors(): Promise<{ rows: SupervisorEntry[]; people: { id: string; name: string }[]; settings: SupervisionSettings; enabled: boolean } | null> {
  const w = await who();
  if (!w?.manager) return null;
  const db = supervisionDb();
  const [{ data, error }, people, { settings }] = await Promise.all([
    db.from("followup_supervisors").select("id, supervisor_id, scope_kind, scope_ref, role, active").order("created_at"),
    followupPeople().catch(() => []),
    readSupervisionSettings(db),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  return {
    rows: ((data ?? []) as (SupervisorRow & { id: string })[]).map((r) => ({ ...r, name: names.get(r.supervisor_id) ?? "—" })),
    people: people.filter((p) => p.person).map((p) => ({ id: p.id, name: p.name })),
    settings,
    enabled: !error,
  };
}

export async function saveSupervisor(input: { supervisorId: string; scopeKind: SupervisorRow["scope_kind"]; scopeRef: string; role: SupervisorRow["role"]; active: boolean }): Promise<Ok | Fail> {
  const w = await who();
  if (!w?.manager) return fail("forbidden");
  if (!UUID.test(input.supervisorId) || !["employee", "team", "inbox", "all"].includes(input.scopeKind) || !["primary", "backup"].includes(input.role)) return fail("قيمة غير صالحة.");
  const ref = input.scopeKind === "all" ? "" : (input.scopeRef ?? "").trim();
  if (input.scopeKind === "employee" && !UUID.test(ref)) return fail("اختر الموظف.");
  if ((input.scopeKind === "team" || input.scopeKind === "inbox") && !/^\d{1,9}$/.test(ref)) return fail("اكتب رقم الفريق أو الصندوق.");
  const db = supervisionDb();
  const { data: before } = await db.from("followup_supervisors").select("role, active").eq("supervisor_id", input.supervisorId).eq("scope_kind", input.scopeKind).eq("scope_ref", ref).maybeSingle();
  const { error } = await db.from("followup_supervisors").upsert(
    { supervisor_id: input.supervisorId, scope_kind: input.scopeKind, scope_ref: ref, role: input.role, active: input.active, created_by: w.me, updated_at: nowIso() },
    { onConflict: "supervisor_id,scope_kind,scope_ref" },
  );
  if (error) return fail("تعذّر الحفظ.");
  await logAudit({ action: "supervision.supervisors_saved", entity: "followup_supervisors", entity_id: input.supervisorId, meta: { scope: `${input.scopeKind}:${ref}`, old: before ?? null, new: { role: input.role, active: input.active } } });
  return { ok: true };
}

export async function saveSupervisionSettings(next: SupervisionSettings): Promise<Ok | Fail> {
  const w = await who();
  if (!w?.manager) return fail("forbidden");
  const clean = parseSupervisionSettings(JSON.stringify(next));
  const db = supervisionDb();
  const { settings: before } = await readSupervisionSettings(db);
  const { error } = await db.from("app_settings").upsert({ key: SUPERVISION_SETTINGS_KEY, value: JSON.stringify(clean), updated_at: nowIso() });
  if (error) return fail("تعذّر الحفظ.");
  await logAudit({ action: "supervision.settings_saved", entity: "app_settings", entity_id: SUPERVISION_SETTINGS_KEY, meta: { old: before, new: clean } });
  return { ok: true };
}

// ------------------------------------------------------------------ reports

export async function getSupervisionReport(days = 30) {
  const w = await who();
  if (!w) return null;
  const db = supervisionDb();
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 180) * 86_400_000).toISOString();
  const { data, error } = await db.from("followup_supervision_cases").select("id,status,level,reason,employee_id,supervisor_id,detected_at,closed_at,escalated_at,proof_kind").gte("detected_at", since).limit(5000);
  if (error) return { employees: [], supervisors: [], names: {}, enabled: false };
  let cases = (data ?? []) as (Omit<ReportCase, "supervisor_acted_at"> & { id: string })[];
  if (!w.manager) {
    const scope = w.scopes.length ? await scopeEmployees(w) : new Set<string>();
    cases = cases.filter((c) => c.employee_id === w.me || (w.scopes.length > 0 && (c.supervisor_id === w.me || scope === null || (c.employee_id != null && scope.has(c.employee_id)))));
  }
  // when the supervisor first acted on each case — from the audit trail, not a stored flag
  const acted = new Map<string, string>();
  if (cases.length) {
    const { data: logs } = await db.from("audit_logs").select("entity_id, created_at, meta, action")
      .in("action", ["supervision.directed", "supervision.rescheduled", "supervision.reassigned", "supervision.escalated"]).gte("created_at", since).limit(5000);
    for (const l of (logs ?? []) as { entity_id: string; created_at: string; meta: { case?: string } | null }[]) {
      const caseId = l.meta?.case ?? l.entity_id;
      if (!acted.has(caseId) || l.created_at < acted.get(caseId)!) acted.set(caseId, l.created_at);
    }
  }
  const report: ReportCase[] = cases.map((c) => ({ ...c, supervisor_acted_at: acted.get(c.id) ?? null }));
  const people = await followupPeople().catch(() => []);
  return { employees: employeeReport(report), supervisors: supervisorReport(report), names: Object.fromEntries(people.map((p) => [p.id, p.name])), enabled: true };
}
