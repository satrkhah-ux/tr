import { describe, expect, it } from "vitest";
import {
  addBusinessMinutes, businessMinutes, clientWaitingSince, detect, employeeReport, nextLevel, parseSupervisionSettings,
  pickSupervisor, planSweep, proofOf, supervisorReport, type CaseRow, type FollowupFacts, type OfficeHours, type SupervisorRow,
} from "./core";

/** the office: every day 09:00–17:00 Riyadh (06:00–14:00 UTC) — Riyadh has no daylight saving */
const HOURS: OfficeHours = { open: "09:00", close: "17:00" };
const at = (iso: string) => Date.parse(iso);
const S = parseSupervisionSettings(null);

const facts = (over: Partial<FollowupFacts> = {}): FollowupFacts => ({
  followupId: "f1", conversationId: 100, employeeId: "emp-a", status: "open", step: 1, heat: "warm",
  nextFollowupAt: null, lastAttemptAt: null, lastClientAt: null, assignedAt: "2026-11-01T06:00:00Z", createdAt: "2026-11-01T06:00:00Z",
  lastBy: null, lastLine: null, conversation: null, postpones14d: 0, ...over,
});
const open = (over: Partial<CaseRow> = {}): CaseRow => ({
  id: "c1", conversation_id: 100, reason: "client_waiting", priority: "normal", level: "employee", employee_id: "emp-a", supervisor_id: null,
  detected_at: "2026-11-01T07:00:00Z", level_due_at: "2026-11-01T07:30:00Z", directive_due_at: null, status: "open", ...over,
});
const always = () => true;

describe("business time", () => {
  it("counts only the office's windows", () => {
    // 16:00 → next day 10:00 Riyadh = 1h today + 1h tomorrow
    expect(businessMinutes(at("2026-11-01T13:00:00Z"), at("2026-11-02T07:00:00Z"), HOURS)).toBe(120);
    // all of it outside the office
    expect(businessMinutes(at("2026-11-01T15:00:00Z"), at("2026-11-02T05:00:00Z"), HOURS)).toBe(0);
  });
  it("a holiday counts nothing, and a window past midnight is counted", () => {
    expect(businessMinutes(at("2026-11-01T06:00:00Z"), at("2026-11-01T14:00:00Z"), HOURS, ["2026-11-01"])).toBe(0);
    const late: OfficeHours = { open: "16:00", close: "00:00" };
    // 23:00 → 01:00 Riyadh: only the hour before midnight
    expect(businessMinutes(at("2026-11-01T20:00:00Z"), at("2026-11-01T22:00:00Z"), late)).toBe(60);
  });
  it("adds working minutes across the night", () => {
    // 16:30 Riyadh + 60 working min = next day 09:30 Riyadh
    expect(new Date(addBusinessMinutes(at("2026-11-01T13:30:00Z"), 60, HOURS)!).toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });
});

describe("«ننتظر العميل» vs «العميل ينتظرنا»", () => {
  it("a closing pleasantry is not a wait; a real question is", () => {
    const conv = { waitingSince: at("2026-11-01T07:00:00Z") / 1000, lastActivityAt: at("2026-11-01T07:00:00Z") / 1000, teamId: null, inboxId: null };
    expect(clientWaitingSince(facts({ conversation: { ...conv, preview: "شكراً لك 🌹" } }))).toBeNull();
    expect(clientWaitingSince(facts({ conversation: { ...conv, preview: "كم السعر للأطفال؟" } }))).toBe(at("2026-11-01T07:00:00Z"));
    // we spoke last: we wait for them
    expect(clientWaitingSince(facts({ conversation: { ...conv, waitingSince: 0, preview: "أرسلنا العرض" } }))).toBeNull();
  });
});

describe("detect", () => {
  const now = at("2026-11-01T08:00:00Z"); // 11:00 Riyadh
  it("the client waiting past the threshold (business time)", () => {
    const f = facts({ conversation: { waitingSince: at("2026-11-01T07:00:00Z") / 1000, lastActivityAt: 0, preview: "متى الحجز؟", teamId: null, inboxId: null } });
    expect(detect(f, S, HOURS, now).map((x) => x.reason)).toEqual(["client_waiting"]);
  });
  it("outside the office the clock stops: a message at 22:00 is not late at 08:00", () => {
    const f = facts({ conversation: { waitingSince: at("2026-11-01T19:00:00Z") / 1000, lastActivityAt: 0, preview: "متى الحجز؟", teamId: null, inboxId: null } });
    expect(detect(f, S, HOURS, at("2026-11-02T05:00:00Z"))).toEqual([]);
  });
  it("a due follow-up not done, and one done after its time", () => {
    const due = facts({ nextFollowupAt: "2026-11-01T06:00:00Z" });
    expect(detect(due, S, HOURS, at("2026-11-01T07:30:00Z")).map((x) => x.reason)).toEqual(["followup_overdue"]);
    expect(detect({ ...due, lastAttemptAt: "2026-11-01T06:10:00Z" }, S, HOURS, at("2026-11-01T07:30:00Z"))).toEqual([]);
  });
  it("no next step for two working days; repeated postponing", () => {
    const idle = facts({ lastAttemptAt: "2026-11-01T06:00:00Z", assignedAt: "2026-11-01T06:00:00Z" });
    expect(detect(idle, S, HOURS, at("2026-11-07T06:00:00Z")).map((x) => x.reason)).toContain("no_next_action");
    expect(detect(facts({ postpones14d: 3, nextFollowupAt: "2026-12-01T06:00:00Z" }), S, HOURS, now).map((x) => x.reason)).toEqual(["repeated_postpone"]);
  });
  it("a department's own thresholds win", () => {
    const s = parseSupervisionSettings(JSON.stringify({ teams: { "7": { normal: { waitingMinutes: 5 } } } }));
    const f = facts({ conversation: { waitingSince: at("2026-11-01T07:50:00Z") / 1000, lastActivityAt: 0, preview: "؟", teamId: 7, inboxId: null } });
    expect(detect(f, s, HOURS, now).map((x) => x.reason)).toEqual(["client_waiting"]);
    expect(detect({ ...f, conversation: { ...f.conversation!, teamId: 8 } }, s, HOURS, now)).toEqual([]);
  });
});

describe("the chain: employee → supervisor → management", () => {
  it("the employee forgets: past their grace the supervisor holds it", () => {
    expect(nextLevel(open(), at("2026-11-01T07:20:00Z"))).toBeNull();
    expect(nextLevel(open(), at("2026-11-01T07:31:00Z"))).toBe("supervisor");
  });
  it("the supervisor forgets: past their grace (or their own directive's due) the management holds it — and there it ends", () => {
    const sup = open({ level: "supervisor", level_due_at: "2026-11-01T08:00:00Z" });
    expect(nextLevel(sup, at("2026-11-01T08:01:00Z"))).toBe("manager");
    expect(nextLevel({ ...sup, directive_due_at: "2026-11-01T09:00:00Z" }, at("2026-11-01T08:30:00Z"))).toBeNull();
    expect(nextLevel(open({ level: "manager", level_due_at: "2026-11-01T08:00:00Z" }), at("2026-11-09T08:00:00Z"))).toBeNull();
  });
});

describe("proof: a real act, never a click", () => {
  const base = { reason: "client_waiting" as const, detectedMs: at("2026-11-01T07:00:00Z"), caseEmployeeId: "emp-a", attemptsSince: [] };
  it("still found → stays open, whatever was pressed", () => {
    expect(proofOf({ ...base, stillFound: true, facts: facts() })).toBeNull();
  });
  it("a reply from Teletel, a delivered message, a logged call", () => {
    const replied = facts({ conversation: { waitingSince: 0, lastActivityAt: at("2026-11-01T07:20:00Z") / 1000, preview: "", teamId: null, inboxId: null } });
    expect(proofOf({ ...base, stillFound: false, facts: replied })).toBe("message_sent");
    expect(proofOf({ ...base, stillFound: false, facts: facts(), attemptsSince: [{ kind: "message", outcome: null, delivered: true }] })).toBe("message_sent");
    expect(proofOf({ ...base, stillFound: false, facts: facts(), attemptsSince: [{ kind: "call", outcome: "interested", delivered: false }] })).toBe("call_logged");
  });
  it("reassignment ends the old employee's case even while the cause remains", () => {
    expect(proofOf({ ...base, stillFound: true, facts: facts({ employeeId: "emp-b" }) })).toBe("reassigned");
  });
});

describe("planSweep", () => {
  const waitingFacts = facts({ conversation: { waitingSince: at("2026-11-01T07:00:00Z") / 1000, lastActivityAt: 0, preview: "متى؟", teamId: null, inboxId: null } });
  const now = at("2026-11-01T08:00:00Z");
  const base = { attemptsSince: () => [], settings: S, hours: HOURS, nowMs: now, available: always, supervisorFor: () => "sup-1" };

  it("no duplicates: an open case for the same conversation and reason is kept, not re-created", () => {
    const first = planSweep({ ...base, facts: [waitingFacts], open: [] });
    expect(first.create).toHaveLength(1);
    expect(first.create[0]).toMatchObject({ level: "employee", reason: "client_waiting", supervisorId: null });
    const second = planSweep({ ...base, facts: [waitingFacts], open: [open({ level_due_at: "2026-11-01T09:00:00Z" })] });
    expect(second.create).toHaveLength(0);
    expect(second.escalate).toHaveLength(0);
    expect(second.close).toHaveLength(0);
  });
  it("the employee away: the supervisor holds it at once", () => {
    const plan = planSweep({ ...base, facts: [waitingFacts], open: [], available: (id) => id !== "emp-a" });
    expect(plan.create[0]).toMatchObject({ level: "supervisor", supervisorId: "sup-1" });
  });
  it("reassigned: the old case closes as «reassigned» and a fresh chain starts for the new employee", () => {
    const plan = planSweep({ ...base, facts: [{ ...waitingFacts, employeeId: "emp-b" }], open: [open()] });
    expect(plan.close).toEqual([{ caseId: "c1", proof: "reassigned" }]);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].employeeId).toBe("emp-b");
  });
  it("the employee forgets → escalation to the supervisor with the supervisor's own due time", () => {
    const plan = planSweep({ ...base, facts: [waitingFacts], open: [open({ level_due_at: "2026-11-01T07:30:00Z" })] });
    expect(plan.escalate).toHaveLength(1);
    expect(plan.escalate[0]).toMatchObject({ caseId: "c1", to: "supervisor", supervisorId: "sup-1" });
    expect(plan.escalate[0].levelDueMs).toBeGreaterThan(now);
  });
  it("the follow-up file closed → the case closes", () => {
    const plan = planSweep({ ...base, facts: [], open: [open()] });
    expect(plan.close).toEqual([{ caseId: "c1", proof: "followup_closed" }]);
  });
});

describe("supervisors", () => {
  const rows: SupervisorRow[] = [
    { supervisor_id: "all-1", scope_kind: "all", scope_ref: "", role: "primary", active: true },
    { supervisor_id: "team-p", scope_kind: "team", scope_ref: "7", role: "primary", active: true },
    { supervisor_id: "team-b", scope_kind: "team", scope_ref: "7", role: "backup", active: true },
  ];
  it("most specific scope first, the backup when the primary is away, never the employee themself", () => {
    expect(pickSupervisor(rows, { employeeId: "emp", teamIds: [7], inboxId: null }, always)).toBe("team-p");
    expect(pickSupervisor(rows, { employeeId: "emp", teamIds: [7], inboxId: null }, (id) => id !== "team-p")).toBe("team-b");
    expect(pickSupervisor(rows, { employeeId: "emp", teamIds: [], inboxId: null }, always)).toBe("all-1");
    expect(pickSupervisor(rows, { employeeId: "team-p", teamIds: [7], inboxId: null }, always)).toBe("team-b");
  });
});

describe("reports", () => {
  it("due / done / overdue, compliance and supervisor performance", () => {
    const c = (over: object) => ({ status: "open" as const, level: "employee" as const, reason: "client_waiting" as const, employee_id: "e", supervisor_id: "s", detected_at: "2026-11-01T07:00:00Z", closed_at: null, escalated_at: null, proof_kind: null, supervisor_acted_at: null, ...over });
    const cases = [
      c({ status: "closed", closed_at: "2026-11-01T07:20:00Z", proof_kind: "message_sent" }),
      c({ level: "supervisor", supervisor_acted_at: "2026-11-01T07:40:00Z" }),
      c({ level: "manager", escalated_at: "2026-11-01T08:00:00Z" }),
    ];
    const [r] = employeeReport(cases);
    expect(r).toMatchObject({ due: 3, done: 1, overdue: 2, compliance: 33, avgHandleMinutes: 20 });
    const [s] = supervisorReport(cases);
    expect(s).toMatchObject({ supervisorId: "s", reached: 2, actedBeforeEscalation: 1, escalated: 1, avgResponseMinutes: 40 });
  });
});

describe("session B's excuses (leave, status buttons) and exemption", () => {
  const now = at("2026-11-01T08:00:00Z"); // 11:00 Riyadh
  const waiting = facts({ conversation: { waitingSince: at("2026-11-01T07:00:00Z") / 1000, lastActivityAt: 0, preview: "متى الحجز؟", teamId: null, inboxId: null } });
  it("time under «لدي عميل» or a prayer is not lateness", () => {
    // 60 minutes waited, 45 of them excused → 15 working minutes, under the normal 30
    const excused = [{ from: at("2026-11-01T07:10:00Z"), to: at("2026-11-01T07:55:00Z"), reason: "client" as const }];
    expect(detect({ ...waiting, excused }, S, HOURS, now)).toEqual([]);
    expect(businessMinutes(at("2026-11-01T07:00:00Z"), now, HOURS, [], excused)).toBe(15);
  });
  it("an exempt colleague has no lateness at all", () => {
    expect(detect({ ...waiting, exempt: true }, S, HOURS, now)).toEqual([]);
  });
});
