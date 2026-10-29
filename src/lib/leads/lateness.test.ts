import { describe, expect, it } from "vitest";
import { exemptConversation, parseLatenessExempt } from "./lateness";

const A = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";

describe("«لا يُحسب عليهم تأخير» (the owner, 2026-10-29)", () => {
  it("reads staff, departments and Teletel teams; drops anything malformed", () => {
    expect(parseLatenessExempt(JSON.stringify({ employees: [A, A, "x"], roles: [R, 5], teams: [1, 1, -2, "3"] }))).toEqual({ employees: [A], roles: [R], teams: [1] });
    expect(parseLatenessExempt("not json")).toEqual({ employees: [], roles: [], teams: [] });
    expect(parseLatenessExempt(null)).toEqual({ employees: [], roles: [], teams: [] });
    expect(parseLatenessExempt("[1,2]")).toEqual({ employees: [], roles: [], teams: [] });
  });

  it("a conversation counts against nobody when its holder or its team is exempt", () => {
    const x = { agentIds: new Set([15]), teamIds: new Set([1]) };
    expect(exemptConversation({ assigneeId: 15, teamId: 38 }, x)).toBe(true);
    expect(exemptConversation({ assigneeId: 17, teamId: 1 }, x)).toBe(true);
    expect(exemptConversation({ assigneeId: 71, teamId: 38 }, x)).toBe(false);
    expect(exemptConversation({ assigneeId: null, teamId: null }, x)).toBe(false);
  });
});
