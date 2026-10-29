import { describe, expect, it } from "vitest";
import { closerOf, decideReturn, durationText, heldSale, phoneKey, readAutocloseHours, staleToClose, travellerReturn, travellersToClose, travelUntil } from "./lifecycle-rules";

describe("a sale stays with its employee (the owner, 2026-10-29: 39733)", () => {
  const sold = { phones: new Set(["550000001"]), wonStages: new Set([36, 4]) };
  it("held by an employee and the client bought — a trip by the mobile, or Teletel's «won» stage — is protected", () => {
    expect(heldSale({ assigneeId: 71, phone: "+966550000001", stageId: 50 }, sold)).toBe(true);
    expect(heldSale({ assigneeId: 71, phone: "+966599999999", stageId: 36 }, sold)).toBe(true);
    expect(heldSale({ assigneeId: 71, phone: "0550000001" }, sold)).toBe(true);
  });
  it("nobody holds it, or nothing was bought: the normal rules", () => {
    expect(heldSale({ assigneeId: null, phone: "+966550000001", stageId: 36 }, sold)).toBe(false);
    expect(heldSale({ assigneeId: 71, phone: "+966599999999", stageId: 50 }, sold)).toBe(false);
    expect(heldSale({ assigneeId: 71, phone: null, stageId: null }, sold)).toBe(false);
  });
});

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

  it("«مؤكد — مسافر قريباً»: matched by the mobile however written, until the return + 3 days, idle an hour, never a waiting client", () => {
    const hour = 3600, now = 1_000_000;
    const file = (id: string, end: string, phones: string[]) => ({ source: "operation" as const, id, serial: null, destination: null, travelStart: null, travelEnd: end, phones, ownerName: "سارة", ownerAgentId: 9 });
    const files = [file("old", "2026-10-01", ["0551234567"]), file("new", "2026-11-10", ["+966 55 123 4567"]), file("back", "2026-10-18", ["0500000001"])];
    const rows = [
      { id: 1, phone: "+966551234567", lastActivityAt: now - 2 * hour, waitingSince: 0 },
      { id: 2, phone: "+966500000001", lastActivityAt: now - 2 * hour, waitingSince: 0 },
      { id: 3, phone: "+966551234567", lastActivityAt: now - 10, waitingSince: 0 },
      { id: 4, phone: "+966551234567", lastActivityAt: now - 2 * hour, waitingSince: now - hour },
      { id: 5, phone: "+966599999999", lastActivityAt: now - 2 * hour, waitingSince: 0 },
    ];
    // 2026-10-22: «back» returned on the 18th — its 3 days are over; «new» is the latest trip of that mobile
    expect(travellersToClose(rows, files, now, "2026-10-22").map((x) => [x.c.id, x.file.id])).toEqual([[1, "new"]]);
    expect(travelUntil("2026-10-30")).toBe("2026-11-02");
    expect(phoneKey("05 5123 4567")).toBe("551234567");
    expect(phoneKey("٠٥٥١٢٣٤٥٦٧")).toBe("551234567");
    expect(phoneKey("12345")).toBeNull();
  });

  it("a traveller writes: to the file's owner until the return + 3 days, then the normal rules", () => {
    expect(travellerReturn("2026-11-02", "2026-10-25", 9, 40)).toEqual({ act: "assign", agentId: 9 });
    expect(travellerReturn("2026-11-02", "2026-11-02", 9, 9)).toEqual({ act: "keep" });
    expect(travellerReturn("2026-11-02", "2026-10-25", null, 40)).toEqual({ act: "keep" });
    expect(travellerReturn("2026-11-02", "2026-11-03", 9, 40)).toBeNull();
    expect(travellerReturn(null, "2026-10-25", 9, 40)).toBeNull();
  });

  it("the setting: whole hours from 1 to 90 days, anything else is off; said in words", () => {
    expect(readAutocloseHours("168")).toBe(168);
    for (const raw of [null, "", "0", "-5", "abc", String(24 * 91)]) expect(readAutocloseHours(raw)).toBeNull();
    expect([24, 48, 168, 36, 1].map(durationText)).toEqual(["يوم", "يومين", "7 أيام", "36 ساعة", "ساعة"]);
  });
});
