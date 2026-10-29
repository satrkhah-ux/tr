import "server-only";
import { logAudit } from "@/lib/data/audit";
import { notifyEmployee } from "@/lib/notifications/notify";
import { addBusinessMinutes, LEVEL_LABEL, planSweep, pickSupervisor, REASON_LABEL, type CaseRow, type FollowupFacts } from "./core";
import { availableEmployees, readFacts, readSupervisionSettings, readSupervisors, supervisionDb, teamsOfEmployees } from "./data";

/**
 * «إشراف المتابعة» — the sweep on the minute job (api/murad/run): read the
 * facts, plan (core.ts planSweep), write the plan. Each case is told once per
 * level (the notification's dedupe key), never twice: an open case for the same
 * conversation and reason is kept, and the database's own unique index holds
 * that even if two runs overlap. Nothing here writes to a client.
 */

const CASE_COLS = "id, conversation_id, reason, priority, level, employee_id, supervisor_id, detected_at, level_due_at, directive_due_at, status, followup_id";
const SYSTEM = { id: null, label: "followup-supervision" };

export async function sweepFollowupSupervision(nowMs = Date.now()): Promise<Record<string, unknown>> {
  const db = supervisionDb();
  const { settings, hours } = await readSupervisionSettings(db);
  if (!settings.on) return { off: true };
  const supervisors = await readSupervisors(db);
  if (supervisors === null) return { error: "table_missing" };

  const [{ facts, teletel }, { data: openRows, error }, available] = await Promise.all([
    readFacts(db, undefined, nowMs),
    db.from("followup_supervision_cases").select(CASE_COLS).eq("status", "open").limit(2000),
    availableEmployees(db, nowMs),
  ]);
  if (error) return { error: "cases_unreadable" };
  // without Teletel the waits cannot be read: no case is opened or closed on a guess
  if (!teletel) return { teletel: false };
  const open = (openRows ?? []) as (CaseRow & { followup_id: string | null })[];

  // the attempts after each open case began — the proof a case may close on
  const attempts = new Map<string, { kind: string; outcome: string | null; delivered: boolean }[]>();
  const followupIds = [...new Set(open.map((c) => c.followup_id).filter((x): x is string => Boolean(x)))];
  if (followupIds.length) {
    const since = open.reduce((m, c) => (c.detected_at < m ? c.detected_at : m), new Date(nowMs).toISOString());
    const { data } = await db.from("followup_attempts").select("followup_id, kind, outcome, delivery_state, created_at").in("followup_id", followupIds).gte("created_at", since).limit(5000);
    const rows = (data ?? []) as { followup_id: string; kind: string; outcome: string | null; delivery_state: string; created_at: string }[];
    for (const c of open) {
      attempts.set(c.id, rows.filter((a) => a.followup_id === c.followup_id && a.created_at >= c.detected_at).map((a) => ({ kind: a.kind, outcome: a.outcome, delivered: a.delivery_state === "sent" })));
    }
  }

  const teamIds = supervisors.filter((s) => s.scope_kind === "team").map((s) => Number(s.scope_ref)).filter(Number.isFinite);
  const teamsOf = await teamsOfEmployees(db, teamIds);
  const supervisorFor = (f: FollowupFacts) =>
    pickSupervisor(supervisors, { employeeId: f.employeeId, teamIds: teamsOf.get(f.employeeId ?? "") ?? [], inboxId: f.conversation?.inboxId ?? null }, (id) => available.has(id));

  const plan = planSweep({
    facts, open, settings, hours, nowMs,
    attemptsSince: (id) => attempts.get(id) ?? [],
    available: (id) => available.has(id),
    supervisorFor,
  });
  const nowIso = new Date(nowMs).toISOString();
  const factsOf = new Map(facts.map((f) => [f.conversationId, f]));
  const caseOf = new Map(open.map((c) => [c.id, c]));

  // 1. close first: a reassigned file's fresh case may be created in the same run
  for (const c of plan.close) {
    const { error: e } = await db.from("followup_supervision_cases").update({ status: "closed", closed_at: nowIso, proof_kind: c.proof, updated_at: nowIso }).eq("id", c.caseId).eq("status", "open");
    if (!e) await logAudit({ action: "supervision.case_closed", entity: "followup_supervision_cases", entity_id: c.caseId, meta: { proof: c.proof, by: "sweep" }, actor: SYSTEM });
  }

  // 2. up the chain
  for (const e of plan.escalate) {
    const prev = caseOf.get(e.caseId);
    const { error: err } = await db
      .from("followup_supervision_cases")
      .update({ level: e.to, supervisor_id: e.supervisorId, level_due_at: e.levelDueMs ? new Date(e.levelDueMs).toISOString() : null, escalated_at: e.to === "manager" ? nowIso : undefined, updated_at: nowIso, last_evaluated_at: nowIso })
      .eq("id", e.caseId)
      .eq("status", "open")
      .eq("level", prev?.level ?? "employee");
    if (err || !prev) continue;
    await logAudit({ action: "supervision.case_escalated", entity: "followup_supervision_cases", entity_id: e.caseId, meta: { from: prev.level, to: e.to, supervisor: e.supervisorId }, actor: SYSTEM });
    await tell(e.to, e.caseId, prev.reason, factsOf.get(prev.conversation_id) ?? null, prev.employee_id, e.supervisorId);
  }

  // 3. new cases
  let created = 0;
  for (const n of plan.create) {
    const { data: row, error: err } = await db
      .from("followup_supervision_cases")
      .insert({
        followup_id: n.followupId, conversation_id: n.conversationId, employee_id: n.employeeId, supervisor_id: n.supervisorId,
        reason: n.reason, priority: n.priority, level: n.level, since_at: new Date(n.sinceMs).toISOString(),
        level_due_at: n.levelDueMs ? new Date(n.levelDueMs).toISOString() : null, detected_at: nowIso,
      })
      .select("id")
      .maybeSingle();
    // 23505: the same open case already exists (an overlapping run) — the point of the index, not an error
    if (err || !row) continue;
    created += 1;
    const id = (row as { id: string }).id;
    await logAudit({ action: "supervision.case_opened", entity: "followup_supervision_cases", entity_id: id, meta: { reason: n.reason, level: n.level, priority: n.priority, employee: n.employeeId }, actor: SYSTEM });
    await tell(n.level, id, n.reason, factsOf.get(n.conversationId) ?? null, n.employeeId, n.supervisorId);
  }
  return { open: open.length, created, escalated: plan.escalate.length, closed: plan.close.length };
}

/** one notification per case and level — the dedupe key holds it to once */
async function tell(level: CaseRow["level"], caseId: string, reason: CaseRow["reason"], f: FollowupFacts | null, employeeId: string | null, supervisorId: string | null) {
  const name = f ? `محادثة #${f.conversationId}` : "حالة";
  const base = { kind: "supervision", source: "followups", href: "/followups/supervision", dedupeKey: `sup:${caseId}:${level}` };
  const body = `${REASON_LABEL[reason]} — ${LEVEL_LABEL[level]}`;
  // the employee is sent to their own follow-up file (where they act); the supervisors and the management to the board
  if (level === "employee" && employeeId) await notifyEmployee({ ...base, href: f ? `/followups/${f.followupId}` : base.href, employeeId, title: `⏱ ${REASON_LABEL[reason]} — ${name}`, body: "عالجها قبل أن تصل للمشرف." }).catch(() => null);
  else if (level === "supervisor" && supervisorId) await notifyEmployee({ ...base, employeeId: supervisorId, title: `👁 حالة تحتاج إشرافك — ${name}`, body }).catch(() => null);
  else if (level === "manager") await notifyEmployee({ ...base, permission: "followups.manage", title: `🚨 تصعيد للإدارة — ${name}`, body }).catch(() => null);
}

/** the employee's grace from now, for a supervisor's reschedule/directive (exported for actions.ts) */
export function graceFrom(nowMs: number, minutes: number, hours: Parameters<typeof addBusinessMinutes>[2], holidays: string[]): string | null {
  const due = addBusinessMinutes(nowMs, minutes, hours, holidays);
  return due ? new Date(due).toISOString() : null;
}
