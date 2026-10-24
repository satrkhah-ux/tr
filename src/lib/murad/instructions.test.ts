import { describe as group, expect, it } from "vitest";
import { defaultControl } from "./control";
import { applyActions, describe, isRefusal, isUndo, toActions, type Reading } from "./instructions";

const ctx = { agents: [{ id: 7, name: "ريموندا" }, { id: 9, name: "رشا" }], teams: [{ id: 1, name: "فيزا" }, { id: 38, name: "المبيعات" }] };
const act = (a: Partial<Reading["actions"][number]> & Pick<Reading["actions"][number], "do">): Reading["actions"][number] =>
  ({ kind: null, mode: null, agent_id: null, team_id: null, minutes: null, task: null, on: null, scope: null, ...a });
const reading = (actions: Reading["actions"]): Reading =>
  ({ type: "decision", actions, lesson_question: null, lesson_answer: null, lesson_kind: null, conversation_id: null, ask_back: null });

group("management instructions", () => {
  it("«لا تستلم اي طلب يخص التأشيرات» keeps visas for the team, and says so", () => {
    const actions = toActions(reading([act({ do: "kind_mode", kind: "تأشيرات", mode: "off" })]), ctx);
    const next = applyActions(defaultControl(), "test", actions)!;
    expect(next.control.kinds?.["تأشيرات"]).toBe("off");
    expect(describe(actions[0]!, ctx)).toBe("قسم التأشيرات: لا يتدخل — يتركه للقسم");
  });
  it("pauses and resumes a colleague, sets the late rule, and widens the scope", () => {
    const actions = toActions(reading([act({ do: "pause", agent_id: 9 }), act({ do: "late", minutes: 15, agent_id: 7 }), act({ do: "scope", scope: "all" })]), ctx);
    const next = applyActions(defaultControl(), "test", actions)!;
    expect(next.control.paused).toEqual([9]);
    expect(next.control.late).toEqual({ minutes: 15, agentId: 7 });
    expect(next.scope).toBe("all");
    expect(applyActions(next.control, next.scope, toActions(reading([act({ do: "resume", agent_id: 9 })]), ctx))!.control.paused).toEqual([]);
  });
  it("drops what names a colleague or department the system does not know — never guesses an id", () => {
    expect(toActions(reading([act({ do: "pause", agent_id: 999 }), act({ do: "route", kind: "طيران", team_id: 555 }), act({ do: "late", minutes: 0, agent_id: 7 })]), ctx)).toEqual([]);
    expect(toActions(reading([act({ do: "route", kind: "طيران", team_id: 38 })]), ctx)).toEqual([{ do: "route", kind: "طيران", teamId: 38, agentId: null }]);
  });
  it("hears «تراجع» and nothing longer", () => {
    expect(isUndo("تراجع")).toBe(true);
    expect(isUndo(" تراجع. ")).toBe(true);
    expect(isUndo("الغ آخر قرار")).toBe(true);
    expect(isUndo("تراجع عن التأشيرات وحولها لرشا")).toBe(false);
    // «لا» after a lesson refuses it (the owner's test, 2026-10-24) — a sentence starting with «لا» is not one
    expect(isRefusal("لا")).toBe(true);
    expect(isRefusal("غلط")).toBe(true);
    expect(isRefusal("لا تستلم التأشيرات")).toBe(false);
  });
});
