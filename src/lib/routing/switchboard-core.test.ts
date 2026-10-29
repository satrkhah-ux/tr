import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, moveReason, parseRules, pickCandidate, type Candidate } from "./switchboard-core";

const c = (agentId: number, over: Partial<Candidate> = {}): Candidate => ({
  agentId,
  name: `موظف ${agentId}`,
  employeeId: `e${agentId}`,
  available: true,
  reason: null,
  paused: false,
  inboxOk: true,
  waiting: 0,
  open: 0,
  ...over,
});
const rules = DEFAULT_RULES;

describe("«البدّالة» — who takes the client", () => {
  it("the available colleague with the fewest waiting, then the fewest open", () => {
    expect(pickCandidate([c(1, { waiting: 3 }), c(2, { waiting: 1, open: 9 }), c(3, { waiting: 1, open: 2 })], {}, rules)?.candidate.agentId).toBe(3);
  });

  it("never someone on leave, on a button, offline, paused, a shared login, without the inbox, or a stranger", () => {
    const nobody = [
      c(1, { available: false, reason: "leave" }),
      c(2, { available: false, reason: "break" }),
      c(3, { available: false, reason: "offline" }),
      c(4, { paused: true }),
      c(68),
      c(5, { inboxOk: false }),
      c(6, { employeeId: null }),
    ];
    expect(pickCandidate(nobody, {}, rules)).toBeNull();
    // an exempt colleague is available
    expect(pickCandidate([c(7, { reason: "exempt" })], {}, rules)?.candidate.agentId).toBe(7);
  });

  it("keeps the holder when they can, then the colleague who registered the client", () => {
    const cands = [c(1, { waiting: 0 }), c(2, { waiting: 5 }), c(3, { waiting: 9 })];
    expect(pickCandidate(cands, { holderAgentId: 2, hintEmployeeId: "e3" }, rules)).toMatchObject({ candidate: { agentId: 2 }, why: "holder" });
    expect(pickCandidate(cands, { hintEmployeeId: "e3" }, rules)).toMatchObject({ candidate: { agentId: 3 }, why: "hint" });
    // the one who registered them is on a prayer: the least loaded instead
    expect(pickCandidate([c(1), c(3, { available: false, reason: "break" })], { hintEmployeeId: "e3" }, rules)).toMatchObject({
      candidate: { agentId: 1 },
      why: "load",
    });
  });

  it("respects a cap on waiting clients", () => {
    expect(pickCandidate([c(1, { waiting: 4 })], {}, { ...rules, maxWaiting: 4 })).toBeNull();
    expect(pickCandidate([c(1, { waiting: 3 })], {}, { ...rules, maxWaiting: 4 })?.candidate.agentId).toBe(1);
  });
});

describe("«البدّالة» — when a client moves", () => {
  const now = 1_800_000_000;
  const waiting = (minutes: number, assigneeId: number | null, teamId: number | null = 38) => ({ assigneeId, teamId, waitingSince: now - minutes * 60 });
  const here = { employeeId: "e1", available: true, reason: null };
  const on = { nowSec: now, working: true, protectedSale: false };

  it("a client waiting on nobody, or on a shared login, past the orphan minutes", () => {
    expect(moveReason(waiting(6, null), null, rules, on)).toBe("orphan");
    expect(moveReason(waiting(6, 68), { employeeId: null, available: false, reason: null }, rules, on)).toBe("orphan");
    expect(moveReason(waiting(3, null), null, rules, on)).toBeNull();
  });

  it("a client waiting on a colleague who is away past the away minutes — not on one who is here", () => {
    expect(moveReason(waiting(20, 1), { employeeId: "e1", available: false, reason: "leave" }, rules, on)).toBe("away");
    expect(moveReason(waiting(20, 1), { employeeId: "e1", available: false, reason: "break" }, rules, on)).toBe("away");
    expect(moveReason(waiting(10, 1), { employeeId: "e1", available: false, reason: "break" }, rules, on)).toBeNull();
    expect(moveReason(waiting(200, 1), here, rules, on)).toBeNull();
  });

  it("never a sale, never outside the working hours, never when off, never when nobody waits", () => {
    const away = { employeeId: "e1", available: false, reason: "leave" as const };
    expect(moveReason(waiting(60, 1), away, rules, { ...on, protectedSale: true })).toBeNull();
    expect(moveReason(waiting(60, null), null, rules, { ...on, working: false })).toBeNull();
    expect(moveReason(waiting(60, null), null, { ...rules, mode: "off" }, on)).toBeNull();
    expect(moveReason({ assigneeId: null, teamId: 38, waitingSince: 0 }, null, rules, on)).toBeNull();
  });
});

describe("the rules", () => {
  it("read the old «لا طلب بلا صاحب» setting until saved, and keep sane bounds", () => {
    expect(parseRules(null, "off").mode).toBe("off");
    expect(parseRules(null, '{"agents":[70],"teams":[29],"salesTeam":40,"minutes":8}')).toMatchObject({
      mode: "on",
      sharedAgents: [70],
      sharedTeams: [29],
      salesTeam: 40,
      orphanMinutes: 8,
    });
    expect(parseRules('{"mode":"dry","awayMinutes":30,"orphanMinutes":0,"maxWaiting":6}', "off")).toMatchObject({
      mode: "dry",
      awayMinutes: 30,
      orphanMinutes: 5,
      maxWaiting: 6,
    });
    expect(parseRules(null, null)).toEqual(DEFAULT_RULES);
  });
});
