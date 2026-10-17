import { describe, expect, it } from "vitest";
import { autoFollowup, autoTeamMove, slaClock, suggestRules, tierFor, waitParts, type SlaRule } from "./classify";

const rule = (id: string, kind: SlaRule["kind"], amount: number, unit: SlaRule["unit"], over: Partial<SlaRule> = {}): SlaRule => ({
  id,
  kind,
  name: id,
  amount,
  unit,
  color: "#000",
  to_followup: false,
  teletel_team_id: null,
  teletel_team_name: null,
  active: true,
  ...over,
});

const NOW = 1_800_000_000;

describe("which clock a conversation runs on", () => {
  it("a new conversation nobody answered: since it began", () => {
    expect(slaClock({ waitingSince: 0, firstReplyAt: null, lastActivityAt: NOW, createdAt: NOW - 600 }, NOW)).toEqual({ kind: "first_reply", minutes: 10 });
  });
  it("the client spoke last: since their message", () => {
    expect(slaClock({ waitingSince: NOW - 7200, firstReplyAt: NOW - 9000, lastActivityAt: NOW - 7200, createdAt: NOW - 9999 }, NOW)).toEqual({ kind: "waiting", minutes: 120 });
  });
  it("we spoke last: cold since the last activity", () => {
    expect(slaClock({ waitingSince: 0, firstReplyAt: NOW - 9000, lastActivityAt: NOW - 3 * 86400, createdAt: NOW - 9999 }, NOW)).toEqual({ kind: "cold", minutes: 4320 });
  });
});

describe("the rule a wait has reached", () => {
  const rules = [
    rule("late", "waiting", 15, "minute"),
    rule("critical", "waiting", 2, "hour", { to_followup: true }),
    rule("off", "waiting", 1, "minute", { active: false }),
    rule("cold", "cold", 1, "day"),
  ];
  it("on time below the first limit (an inactive rule counts for nothing)", () => {
    expect(tierFor(rules, "waiting", 10)).toBeNull();
  });
  it("the longest limit reached, of its own kind only", () => {
    expect(tierFor(rules, "waiting", 15)?.id).toBe("late");
    expect(tierFor(rules, "waiting", 119)?.id).toBe("late");
    expect(tierFor(rules, "waiting", 120)?.id).toBe("critical");
    expect(tierFor(rules, "first_reply", 9999)).toBeNull();
    expect(tierFor(rules, "cold", 1440)?.id).toBe("cold");
  });
});

it("moves to «المتابعة» on its own only a recent delay, under a rule marked for it", () => {
  const marked = rule("critical", "waiting", 2, "hour", { to_followup: true });
  expect(autoFollowup(marked, 120)).toBe(true);
  expect(autoFollowup(marked, 7 * 1440)).toBe(true);
  expect(autoFollowup(marked, 7 * 1440 + 1)).toBe(false);
  expect(autoFollowup(rule("late", "waiting", 15, "minute"), 120)).toBe(false);
  expect(autoFollowup(null, 120)).toBe(false);
});

it("hands a conversation to a Teletel team once: a recent delay, not already there; never to our list as well", () => {
  const team = rule("critical", "waiting", 4, "hour", { teletel_team_id: 28, teletel_team_name: "متابعة المبيعات", to_followup: true });
  expect(autoTeamMove(team, 300, 38)).toBe(28);
  expect(autoTeamMove(team, 300, 28)).toBeNull();
  expect(autoTeamMove(team, 7 * 1440 + 1, 38)).toBeNull();
  expect(autoTeamMove(rule("late", "waiting", 15, "minute"), 300, 38)).toBeNull();
  // a team rule is the team's move, not «المتابعة» too
  expect(autoFollowup(team, 300)).toBe(false);
});

describe("«قواعد مقترحة بناء على محادثات النظام»", () => {
  const rows = [
    { kind: "waiting" as const, minutes: 45 },
    { kind: "waiting" as const, minutes: 300 },
    { kind: "waiting" as const, minutes: 3000 },
    { kind: "waiting" as const, minutes: 20 * 1440 },
    { kind: "cold" as const, minutes: 5000 },
  ];
  const teams = [
    { id: 25, name: "قسم الطلبات" },
    { id: 28, name: "متابعة المبيعات " },
  ];

  it("counts what each would catch now — recent conversations only", () => {
    const s = suggestRules(rows, teams, []);
    const by = Object.fromEntries(s.map((x) => [x.key, x]));
    expect(by.waiting_30m.hits).toBe(3);
    expect(by.waiting_4h.hits).toBe(2);
    expect(by.waiting_1d.hits).toBe(1);
    expect(by.waiting_1d.ofKind).toBe(4);
    expect(by.cold_3d.hits).toBe(1);
  });

  it("sends to the team that exists, else to our «المتابعة»; marks the ones already there", () => {
    const s = Object.fromEntries(suggestRules(rows, teams, [rule("x", "waiting", 30, "minute")]).map((x) => [x.key, x]));
    expect(s.waiting_4h.rule).toMatchObject({ teletel_team_id: 28, to_followup: false });
    expect(s.first_15m.rule).toMatchObject({ teletel_team_id: 25 });
    expect(s.waiting_1d.rule).toMatchObject({ teletel_team_id: null, to_followup: true });
    expect(s.waiting_30m.exists).toBe(true);
    // the same limit moving elsewhere is not «added»: the suggestion updates it
    const elsewhere = Object.fromEntries(suggestRules(rows, teams, [rule("old", "waiting", 4, "hour", { to_followup: true })]).map((x) => [x.key, x]));
    expect(elsewhere.waiting_4h).toMatchObject({ exists: false, replaces: "old" });
    const noTeams = Object.fromEntries(suggestRules(rows, [], []).map((x) => [x.key, x]));
    expect(noTeams.waiting_4h.rule).toMatchObject({ teletel_team_id: null, to_followup: true });
  });
});

it("says a wait in its largest whole unit", () => {
  expect(waitParts(45)).toEqual({ n: 45, unit: "minute" });
  expect(waitParts(150)).toEqual({ n: 2, unit: "hour" });
  expect(waitParts(3000)).toEqual({ n: 2, unit: "day" });
});
