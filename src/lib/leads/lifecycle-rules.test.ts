import { describe, expect, it } from "vitest";
import { closerOf, decideReturn, durationText, readAutocloseHours, staleToClose } from "./lifecycle-rules";

const agents = [
  { id: 30, name: "محمد الحبيب ", email: "m.habib@traveliun.com" },
  { id: 40, name: "اسوار", email: "Aswar@traveliun.com" },
];
const act = (at: number, text: string) => ({ kind: "activity", at, text });

describe("the conversation's life in Teletel (order 2, part C)", () => {
  it("reads who resolved it from Teletel's own line — the latest, by name or email", () => {
    const events = [act(100, 'تم تحديث حالة المحادثة لـ"مغلقة" بواسطة اسوار'), act(200, 'تم تحديث حالة المحادثة لـ"مغلقة" بواسطة محمد الحبيب '), act(300, "تم إسنادها إلى رشا بواسطة اسوار")];
    expect(closerOf(events, 1000, agents)).toEqual({ name: "محمد الحبيب", agentId: 30, at: 200 });
    expect(closerOf(events, 150, agents)).toEqual({ name: "اسوار", agentId: 40, at: 100 });
    expect(closerOf([act(100, 'تم تحديث حالة المحادثة لـ"مغلقة" بواسطة Aswar@traveliun.com')], 1000, agents)?.agentId).toBe(40);
    expect(closerOf([act(100, 'تم تحديث حالة المحادثة لـ"مغلقة" بواسطة موظف قديم')], 1000, agents)).toEqual({ name: "موظف قديم", agentId: null, at: 100 });
    expect(closerOf([act(100, "تم إعادة فتح المحادثة بواسطة اسوار")], 1000, agents)).toBeNull();
  });

  it("closed by an employee: back to THAT employee; by the system: unassigned, a new request", () => {
    expect(decideReturn({ closed_by_kind: "employee", closed_by_agent_id: 30 }, 40)).toEqual({ act: "assign", agentId: 30 });
    expect(decideReturn({ closed_by_kind: "employee", closed_by_agent_id: 30 }, 30)).toEqual({ act: "keep" });
    expect(decideReturn({ closed_by_kind: "employee", closed_by_agent_id: null }, 40)).toEqual({ act: "keep" });
    expect(decideReturn({ closed_by_kind: "system", closed_by_agent_id: null }, 40)).toEqual({ act: "unassign" });
  });

  it("the system closes only idle conversations where we spoke last — never a waiting client", () => {
    const day = 86_400, now = 100 * day;
    const rows = [
      { id: 1, lastActivityAt: now - 10 * day, waitingSince: 0 },
      { id: 2, lastActivityAt: now - 20 * day, waitingSince: 0 },
      { id: 3, lastActivityAt: now - 30 * day, waitingSince: now - 30 * day },
      { id: 4, lastActivityAt: now - 2 * day, waitingSince: 0 },
    ];
    expect(staleToClose(rows, now, 7 * 24).map((r) => r.id)).toEqual([2, 1]);
    expect(staleToClose(rows, now, 0)).toEqual([]);
  });

  it("the setting: whole hours from 1 to 90 days, anything else is off; said in words", () => {
    expect(readAutocloseHours("168")).toBe(168);
    for (const raw of [null, "", "0", "-5", "abc", String(24 * 91)]) expect(readAutocloseHours(raw)).toBeNull();
    expect([24, 48, 168, 36, 1].map(durationText)).toEqual(["يوم", "يومين", "7 أيام", "36 ساعة", "ساعة"]);
  });
});
