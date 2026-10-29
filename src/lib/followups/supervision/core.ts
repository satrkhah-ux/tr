/**
 * «إشراف المتابعة» (the owner, 2026-10-29) — the pure rules. Everything here is
 * computed from what «المتابعة» already holds (sla_followups, its attempts, the
 * Teletel conversation): no new client or message records.
 *
 *  · detect(): why a follow-up needs a supervisor's eye — the client waits on us
 *    too long, a follow-up came due and was not done, an active file has no next
 *    step, or it keeps being postponed. «We wait for the client» is told from
 *    «the client waits for us» with the courtesy rules (teletel-courtesy).
 *  · business time: delays count only the office's working windows, minus
 *    holidays (until session B's switchboard function replaces it).
 *  · the chain: the employee is told first; past their grace the case reaches a
 *    supervisor (primary, else an available backup); past the supervisor's own
 *    grace it reaches the management, where it ends.
 *  · proof: a case closes on a REAL act seen in the data — a message sent, a call
 *    logged with its result, a reassignment, the client's reply — never a click.
 */
import { isClosingCourtesy } from "@/lib/providers/teletel-courtesy";

export type Priority = "high" | "normal" | "low";
export type Reason = "client_waiting" | "followup_overdue" | "no_next_action" | "repeated_postpone";
export type Level = "employee" | "supervisor" | "manager";
export type ProofKind = "message_sent" | "call_logged" | "reassigned" | "client_replied" | "resolved" | "followup_closed";

export const REASON_LABEL: Record<Reason, string> = {
  client_waiting: "العميل ينتظر ردنا",
  followup_overdue: "متابعة حان موعدها ولم تُنفذ",
  no_next_action: "حالة نشطة بلا إجراء أو موعد قادم",
  repeated_postpone: "تأجيل متكرر بلا نتيجة",
};
export const LEVEL_LABEL: Record<Level, string> = { employee: "عند الموظف", supervisor: "عند المشرف", manager: "عند الإدارة" };
export const PRIORITY_LABEL: Record<Priority, string> = { high: "عالية", normal: "عادية", low: "منخفضة" };
export const PROOF_LABEL: Record<ProofKind, string> = {
  message_sent: "أُرسلت رسالة للعميل",
  call_logged: "مكالمة موثّقة بنتيجتها",
  reassigned: "أُعيد الإسناد",
  client_replied: "ردّ العميل",
  resolved: "زال السبب",
  followup_closed: "أُغلق ملف المتابعة",
};

// ---------------------------------------------------------------- settings

export type Thresholds = {
  /** the client waits on us longer than this (business minutes) */
  waitingMinutes: number;
  /** a due follow-up left undone this long (business minutes) */
  dueGraceMinutes: number;
  /** an active file with no next step for this long (business hours) */
  idleHours: number;
  /** postponed this many times in 14 days without a result */
  postponeCount: number;
  /** the employee's grace once told, before the supervisor (business minutes) */
  employeeMinutes: number;
  /** the supervisor's own grace, before the management (business minutes) */
  supervisorMinutes: number;
};
export type SupervisionSettings = {
  on: boolean;
  thresholds: Record<Priority, Thresholds>;
  /** a Teletel team's own thresholds (the department), over the defaults */
  teams: Record<string, Partial<Record<Priority, Partial<Thresholds>>>>;
  /** «YYYY-MM-DD» days the office is closed */
  holidays: string[];
};
export const SUPERVISION_SETTINGS_KEY = "followup_supervision";

export const DEFAULT_THRESHOLDS: Record<Priority, Thresholds> = {
  high: { waitingMinutes: 15, dueGraceMinutes: 30, idleHours: 24, postponeCount: 3, employeeMinutes: 15, supervisorMinutes: 30 },
  normal: { waitingMinutes: 30, dueGraceMinutes: 60, idleHours: 48, postponeCount: 3, employeeMinutes: 30, supervisorMinutes: 60 },
  low: { waitingMinutes: 60, dueGraceMinutes: 120, idleHours: 72, postponeCount: 4, employeeMinutes: 60, supervisorMinutes: 120 },
};

const KEYS: (keyof Thresholds)[] = ["waitingMinutes", "dueGraceMinutes", "idleHours", "postponeCount", "employeeMinutes", "supervisorMinutes"];
const PRIORITIES: Priority[] = ["high", "normal", "low"];
const positive = (v: unknown): number | null => (Number.isFinite(v) && Number(v) > 0 && Number(v) <= 100_000 ? Number(v) : null);

export function parseSupervisionSettings(raw: string | null | undefined): SupervisionSettings {
  const base: SupervisionSettings = { on: true, thresholds: structuredClone(DEFAULT_THRESHOLDS), teams: {}, holidays: [] };
  if (!raw) return base;
  try {
    const v = JSON.parse(raw) as Partial<SupervisionSettings>;
    const thresholds = structuredClone(DEFAULT_THRESHOLDS);
    for (const p of PRIORITIES) for (const k of KEYS) thresholds[p][k] = positive(v.thresholds?.[p]?.[k]) ?? thresholds[p][k];
    const teams: SupervisionSettings["teams"] = {};
    for (const [team, over] of Object.entries(v.teams ?? {})) {
      if (!/^\d{1,9}$/.test(team) || !over || typeof over !== "object") continue;
      for (const p of PRIORITIES) {
        for (const k of KEYS) {
          const n = positive(over[p]?.[k]);
          if (n != null) ((teams[team] ??= {})[p] ??= {})[k] = n;
        }
      }
    }
    const holidays = Array.isArray(v.holidays) ? v.holidays.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 200) : [];
    return { on: v.on !== false, thresholds, teams, holidays };
  } catch {
    return base;
  }
}

/** the thresholds for one case: its priority's, a department's override on top */
export function thresholdsFor(s: SupervisionSettings, priority: Priority, teamId: number | null): Thresholds {
  return { ...s.thresholds[priority], ...(teamId != null ? (s.teams[String(teamId)]?.[priority] ?? {}) : {}) };
}

// ---------------------------------------------------------------- business time

/** the office's windows — the same shape murad_reception_hours parses to (murad/reception.ts Hours) */
export type OfficeHours = { open: string; close: string; week?: { open: string; close: string }[][] };

const RIYADH_MS = 3 * 3600_000; // Asia/Riyadh: UTC+3, no daylight saving
const DAY_MS = 86_400_000;
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const isoDay = (riyadhDayStartUtcMs: number) => new Date(riyadhDayStartUtcMs + RIYADH_MS).toISOString().slice(0, 10);

/** The working intervals [start, end) in UTC ms of the Riyadh day that begins at `dayStart` (UTC ms). */
function dayIntervals(dayStart: number, hours: OfficeHours, holidays: Set<string>): [number, number][] {
  const dow = new Date(dayStart + RIYADH_MS).getUTCDay();
  const week = hours.week ?? Array.from({ length: 7 }, () => [{ open: hours.open, close: hours.close }]);
  const out: [number, number][] = [];
  if (!holidays.has(isoDay(dayStart))) {
    for (const w of week[dow] ?? []) {
      const open = toMin(w.open);
      let close = toMin(w.close);
      // a window closing at or before it opens runs into the next day («16:00-00:00»)
      if (close <= open) close += 24 * 60;
      out.push([dayStart + open * 60_000, dayStart + close * 60_000]);
    }
  }
  return out;
}

const riyadhDayStart = (ms: number) => Math.floor((ms + RIYADH_MS) / DAY_MS) * DAY_MS - RIYADH_MS;

/** Working minutes between two instants (60 days at most are walked). */
export function businessMinutes(fromMs: number, toMs: number, hours: OfficeHours, holidays: string[] = []): number {
  if (!(toMs > fromMs)) return 0;
  const off = new Set(holidays);
  let total = 0;
  // the day before too: its window may run past midnight into ours
  for (let day = riyadhDayStart(fromMs) - DAY_MS, k = 0; day <= toMs && k < 62; day += DAY_MS, k++) {
    for (const [a, b] of dayIntervals(day, hours, off)) {
      const s = Math.max(a, fromMs);
      const e = Math.min(b, toMs);
      if (e > s) total += e - s;
    }
  }
  return Math.floor(total / 60_000);
}

/** The instant `minutes` working minutes after `fromMs` (null when the office never opens within 60 days). */
export function addBusinessMinutes(fromMs: number, minutes: number, hours: OfficeHours, holidays: string[] = []): number | null {
  const off = new Set(holidays);
  let left = Math.max(minutes, 0) * 60_000;
  for (let day = riyadhDayStart(fromMs) - DAY_MS, k = 0; k < 62; day += DAY_MS, k++) {
    for (const [a, b] of dayIntervals(day, hours, off).sort((x, y) => x[0] - y[0])) {
      const s = Math.max(a, fromMs);
      if (b <= s) continue;
      if (b - s >= left) return s + left;
      left -= b - s;
    }
  }
  return null;
}

// ---------------------------------------------------------------- detection

/** what the sweep knows of one open follow-up (sla_followups + its Teletel conversation + its attempts) */
export type FollowupFacts = {
  followupId: string;
  conversationId: number;
  employeeId: string | null;
  status: "open" | "done";
  step: number | null;
  heat: "hot" | "warm" | "cold" | null;
  nextFollowupAt: string | null;
  lastAttemptAt: string | null;
  lastClientAt: string | null;
  assignedAt: string | null;
  createdAt: string;
  /** «client» when the client wrote last (sla_followups.last_by) */
  lastBy: "client" | "us" | null;
  lastLine: string | null;
  /** the live conversation, when Teletel answered */
  conversation: { waitingSince: number; lastActivityAt: number; preview: string; teamId: number | null; inboxId: number | null } | null;
  /** «later» results (postpones) in the last 14 days, and whether any result since closed the matter */
  postpones14d: number;
};

export type Finding = { reason: Reason; sinceMs: number; minutes: number };

export function priorityOf(f: Pick<FollowupFacts, "heat" | "step">): Priority {
  if (f.heat === "hot") return "high";
  if (f.heat === "cold") return "low";
  return "normal";
}

/**
 * Since when the client waits for US (null: we wait for them). Teletel's own
 * clock first; a pleasantry («شكراً»، «🌹») closing the talk is not a wait.
 */
export function clientWaitingSince(f: FollowupFacts): number | null {
  const c = f.conversation;
  if (c) {
    if (!c.waitingSince) return null;
    return isClosingCourtesy(c.preview) ? null : c.waitingSince * 1000;
  }
  if (f.lastBy === "client" && f.lastClientAt && !isClosingCourtesy(f.lastLine)) return Date.parse(f.lastClientAt);
  return null;
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : 0);

export function detect(f: FollowupFacts, s: SupervisionSettings, hours: OfficeHours, nowMs: number): Finding[] {
  if (f.status !== "open") return [];
  const th = thresholdsFor(s, priorityOf(f), f.conversation?.teamId ?? null);
  const bm = (from: number) => businessMinutes(from, nowMs, hours, s.holidays);
  const out: Finding[] = [];

  const waiting = clientWaitingSince(f);
  if (waiting) {
    const m = bm(waiting);
    if (m >= th.waitingMinutes) out.push({ reason: "client_waiting", sinceMs: waiting, minutes: m });
  }

  const due = ms(f.nextFollowupAt);
  if (due && due <= nowMs && ms(f.lastAttemptAt) < due) {
    const m = bm(due);
    if (m >= th.dueGraceMinutes) out.push({ reason: "followup_overdue", sinceMs: due, minutes: m });
  }

  // nothing planned and nobody waiting on us: is anything happening at all?
  if (!due && !waiting) {
    const lastMove = Math.max(ms(f.lastAttemptAt), ms(f.lastClientAt), ms(f.assignedAt), ms(f.createdAt), (f.conversation?.lastActivityAt ?? 0) * 1000);
    const m = bm(lastMove);
    if (m >= th.idleHours * 60) out.push({ reason: "no_next_action", sinceMs: lastMove, minutes: m });
  }

  if (f.postpones14d >= th.postponeCount) out.push({ reason: "repeated_postpone", sinceMs: ms(f.lastAttemptAt) || nowMs, minutes: 0 });
  return out;
}

// ---------------------------------------------------------------- the chain

export type CaseRow = {
  id: string;
  conversation_id: number;
  reason: Reason;
  priority: Priority;
  level: Level;
  employee_id: string | null;
  supervisor_id: string | null;
  detected_at: string;
  level_due_at: string | null;
  directive_due_at: string | null;
  status: "open" | "closed";
};

/** the next level when the current one's grace (or the supervisor's own directive due time) has passed */
export function nextLevel(c: Pick<CaseRow, "level" | "level_due_at" | "directive_due_at">, nowMs: number): Level | null {
  const due = Math.max(ms(c.level_due_at), c.level === "supervisor" ? ms(c.directive_due_at) : 0);
  if (!due || nowMs < due) return null;
  if (c.level === "employee") return "supervisor";
  if (c.level === "supervisor") return "manager";
  return null; // the chain ends at the management
}

/**
 * What ended a case — read from the data, never from a button. `facts` is the
 * follow-up now; `detectedMs` when the case opened; `stillFound` whether the
 * same reason is detected again.
 */
export function proofOf(input: {
  reason: Reason;
  detectedMs: number;
  stillFound: boolean;
  facts: FollowupFacts | null;
  caseEmployeeId: string | null;
  /** attempts after the case opened: their kind (call, whatsapp, message, note, assign…) and whether they carry a result */
  attemptsSince: { kind: string; outcome: string | null; delivered: boolean }[];
}): ProofKind | null {
  const { facts } = input;
  if (!facts || facts.status === "done") return "followup_closed";
  if (input.caseEmployeeId && facts.employeeId && facts.employeeId !== input.caseEmployeeId) return "reassigned";
  if (input.stillFound) return null;
  if (input.attemptsSince.some((a) => (a.kind === "message" || a.kind === "whatsapp") && a.delivered)) return "message_sent";
  if (input.attemptsSince.some((a) => a.kind === "call" && a.outcome)) return "call_logged";
  const c = facts.conversation;
  // we spoke last after the case opened: a reply went from Teletel itself
  if (c && !c.waitingSince && c.lastActivityAt * 1000 > input.detectedMs) return "message_sent";
  if (ms(facts.lastClientAt) > input.detectedMs && input.reason !== "client_waiting") return "client_replied";
  return "resolved";
}

// ---------------------------------------------------------------- one sweep's decisions

export type SweepPlan = {
  create: { followupId: string; conversationId: number; employeeId: string | null; supervisorId: string | null; reason: Reason; priority: Priority; level: Level; sinceMs: number; levelDueMs: number | null }[];
  escalate: { caseId: string; to: Level; supervisorId: string | null; levelDueMs: number | null }[];
  close: { caseId: string; proof: ProofKind }[];
};

/**
 * One pass over the open follow-ups and the open cases. Pure: the sweep
 * (supervision/sweep.ts) gathers the facts and writes the plan. Never twice the
 * same case: an open (conversation, reason) is kept, not re-created; a case
 * whose cause went closes on the act that ended it; a reassigned file starts a
 * fresh chain for its new employee.
 */
export function planSweep(input: {
  facts: FollowupFacts[];
  open: CaseRow[];
  attemptsSince: (caseId: string) => { kind: string; outcome: string | null; delivered: boolean }[];
  settings: SupervisionSettings;
  hours: OfficeHours;
  nowMs: number;
  /** is this employee at work now (session B's switchboard; presence + hours meanwhile) */
  available: (employeeId: string) => boolean;
  supervisorFor: (f: FollowupFacts) => string | null;
}): SweepPlan {
  const { settings: s, hours, nowMs } = input;
  const plan: SweepPlan = { create: [], escalate: [], close: [] };
  const factsByConv = new Map(input.facts.map((f) => [f.conversationId, f]));
  const findings = new Map(input.facts.map((f) => [f.conversationId, detect(f, s, hours, nowMs)]));
  const stillOpen = new Set<string>();

  for (const c of input.open) {
    const f = factsByConv.get(c.conversation_id) ?? null;
    const stillFound = Boolean(findings.get(c.conversation_id)?.some((x) => x.reason === c.reason));
    const proof = proofOf({ reason: c.reason, detectedMs: ms(c.detected_at), stillFound, facts: f, caseEmployeeId: c.employee_id, attemptsSince: input.attemptsSince(c.id) });
    if (proof) {
      plan.close.push({ caseId: c.id, proof });
      continue;
    }
    stillOpen.add(`${c.conversation_id}:${c.reason}`);
    const to = nextLevel(c, nowMs);
    if (!to || !f) continue;
    const th = thresholdsFor(s, c.priority, f.conversation?.teamId ?? null);
    plan.escalate.push({
      caseId: c.id,
      to,
      supervisorId: to === "supervisor" ? input.supervisorFor(f) : c.supervisor_id,
      levelDueMs: to === "supervisor" ? addBusinessMinutes(nowMs, th.supervisorMinutes, hours, s.holidays) : null,
    });
  }

  for (const f of input.facts) {
    for (const x of findings.get(f.conversationId) ?? []) {
      if (stillOpen.has(`${f.conversationId}:${x.reason}`)) continue;
      const priority = priorityOf(f);
      const th = thresholdsFor(s, priority, f.conversation?.teamId ?? null);
      // an employee away (leave, off shift) cannot be told and waited for: the supervisor holds it at once
      const away = !f.employeeId || !input.available(f.employeeId);
      plan.create.push({
        followupId: f.followupId,
        conversationId: f.conversationId,
        employeeId: f.employeeId,
        supervisorId: away ? input.supervisorFor(f) : null,
        reason: x.reason,
        priority,
        level: away ? "supervisor" : "employee",
        sinceMs: x.sinceMs,
        levelDueMs: addBusinessMinutes(nowMs, away ? th.supervisorMinutes : th.employeeMinutes, hours, s.holidays),
      });
    }
  }
  return plan;
}

// ---------------------------------------------------------------- supervisors

export type SupervisorRow = { supervisor_id: string; scope_kind: "employee" | "team" | "inbox" | "all"; scope_ref: string; role: "primary" | "backup"; active: boolean };

/**
 * Who supervises a case: the most specific scope first (the employee, their
 * team, the conversation's inbox, everyone), primaries before backups; the
 * first AVAILABLE one, else the first primary (someone must hold it).
 */
export function pickSupervisor(
  rows: SupervisorRow[],
  target: { employeeId: string | null; teamIds: number[]; inboxId: number | null },
  available: (employeeId: string) => boolean,
): string | null {
  const rank = (r: SupervisorRow): number | null => {
    if (!r.active || r.supervisor_id === target.employeeId) return null;
    if (r.scope_kind === "employee") return r.scope_ref === target.employeeId ? 0 : null;
    if (r.scope_kind === "team") return target.teamIds.includes(Number(r.scope_ref)) ? 1 : null;
    if (r.scope_kind === "inbox") return target.inboxId != null && Number(r.scope_ref) === target.inboxId ? 2 : null;
    return 3;
  };
  const candidates = rows
    .map((r) => ({ r, k: rank(r) }))
    .filter((x): x is { r: SupervisorRow; k: number } => x.k !== null)
    .sort((a, b) => a.k - b.k || Number(a.r.role === "backup") - Number(b.r.role === "backup"));
  return candidates.find((c) => available(c.r.supervisor_id))?.r.supervisor_id ?? candidates.find((c) => c.r.role === "primary")?.r.supervisor_id ?? candidates[0]?.r.supervisor_id ?? null;
}

// ---------------------------------------------------------------- reports

export type ReportCase = {
  status: "open" | "closed";
  level: Level;
  reason: Reason;
  employee_id: string | null;
  supervisor_id: string | null;
  detected_at: string;
  closed_at: string | null;
  escalated_at: string | null;
  proof_kind: ProofKind | null;
  /** the supervisor acted (directive / reschedule / reassign) — from audit_logs */
  supervisor_acted_at: string | null;
};

export type ReportRow = { key: string; due: number; done: number; overdue: number; compliance: number; avgHandleMinutes: number | null; postpones: number };
export type SupervisorReportRow = { supervisorId: string; reached: number; actedBeforeEscalation: number; escalated: number; avgResponseMinutes: number | null };

/** per employee: due (opened), done (closed by a real act), overdue (still open past the employee), compliance %, average handling */
export function employeeReport(cases: ReportCase[]): ReportRow[] {
  const by = new Map<string, ReportCase[]>();
  for (const c of cases) by.set(c.employee_id ?? "—", [...(by.get(c.employee_id ?? "—") ?? []), c]);
  return [...by.entries()].map(([key, list]) => {
    const done = list.filter((c) => c.status === "closed");
    const handled = done.map((c) => (ms(c.closed_at) - ms(c.detected_at)) / 60_000).filter((m) => m >= 0);
    // compliance: closed while still at the employee's level — never needed the supervisor
    const kept = done.filter((c) => c.level === "employee").length;
    return {
      key,
      due: list.length,
      done: done.length,
      overdue: list.filter((c) => c.status === "open" && c.level !== "employee").length,
      compliance: list.length ? Math.round((kept / list.length) * 100) : 100,
      avgHandleMinutes: handled.length ? Math.round(handled.reduce((a, b) => a + b, 0) / handled.length) : null,
      postpones: list.filter((c) => c.reason === "repeated_postpone").length,
    };
  }).sort((a, b) => b.overdue - a.overdue || a.compliance - b.compliance);
}

export function supervisorReport(cases: ReportCase[]): SupervisorReportRow[] {
  const by = new Map<string, ReportCase[]>();
  for (const c of cases) if (c.supervisor_id && c.level !== "employee") by.set(c.supervisor_id, [...(by.get(c.supervisor_id) ?? []), c]);
  return [...by.entries()].map(([supervisorId, list]) => {
    const acted = list.filter((c) => c.supervisor_acted_at && (!c.escalated_at || c.supervisor_acted_at < c.escalated_at));
    const resp = acted.map((c) => (ms(c.supervisor_acted_at) - ms(c.detected_at)) / 60_000).filter((m) => m >= 0);
    return {
      supervisorId,
      reached: list.length,
      actedBeforeEscalation: acted.length,
      escalated: list.filter((c) => c.level === "manager").length,
      avgResponseMinutes: resp.length ? Math.round(resp.reduce((a, b) => a + b, 0) / resp.length) : null,
    };
  });
}
