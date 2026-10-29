import { describe, expect, it } from "vitest";
import { clientQuery, closerOf, decideReturn, durationText, followedSince, heldSale, marksFollowed, mergeClients, phoneForms, phoneKey, readAutocloseHours, sameClientTrips, staleToClose, travellerReturn, travellersToClose, travelUntil, type ClientRecord } from "./lifecycle-rules";

describe("«المؤكدون خارج النظام»: the client pulled from what we have (the owner, 2026-10-29)", () => {
  const rec = (r: Partial<ClientRecord>): ClientRecord => ({ phone: null, name: null, destination: null, travelStart: null, days: null, at: null, mine: false, source: "lead", ...r });

  it("reads a number however written, else a name; nothing while too short", () => {
    expect(["0551234567", "+966 55 123 4567", "00966551234567", "٠٥٥١٢٣٤٥٦٧"].map(clientQuery)).toEqual(Array(4).fill({ digits: "551234567" }));
    expect(clientQuery("0551")).toEqual({ digits: "551" });
    expect(clientQuery("محمد, (العتيبي)")).toEqual({ name: "محمد   العتيبي" });
    expect([clientQuery("05"), clientQuery("م"), clientQuery("  ")]).toEqual([null, null, null]);
    expect(phoneForms("0551234567")).toEqual(["966551234567", "0551234567", "+966551234567"]);
    expect(phoneForms("+995 599 123 456")).toEqual(["995599123456", "+995599123456"]);
    expect(phoneForms("123")).toEqual([]);
  });

  it("one client per mobile: our files' name over WhatsApp's, the newest recent trip, mine first", () => {
    const out = mergeClients(
      [
        rec({ phone: "+966551234567", name: "Abu Fahad 🌴", destination: "جورجيا", at: "2026-10-20T10:00:00Z", source: "lead" }),
        rec({ phone: "0551234567", name: "فهد العتيبي", destination: "أذربيجان", travelStart: "2026-08-01", days: 6, at: "2026-03-01T00:00:00Z", source: "offer" }),
        rec({ phone: "0559999999", name: "سارة", at: "2026-01-01T00:00:00Z", mine: true, source: "file" }),
        rec({ phone: "12", name: "no number" }),
      ],
      "2026-10-29",
    );
    expect(out).toEqual([
      { phone: "966559999999", name: "سارة", mine: true, sources: ["file"], trip: null },
      // the lead names the newest destination (no dates of its own — never borrowed from the old offer)
      { phone: "966551234567", name: "فهد العتيبي", mine: false, sources: ["lead", "offer"], trip: { destination: "جورجيا", travelStart: null, days: null } },
    ]);
    // an offer older than 120 days pre-fills nothing
    expect(mergeClients([rec({ phone: "0551234567", destination: "تركيا", at: "2026-01-01T00:00:00Z", source: "offer" })], "2026-10-29")[0].trip).toBeNull();
  });

  it("warns of the same mobile's trip here (not the one edited) and its confirmed operations file", () => {
    const trips = [{ id: "t1", phone: "966551234567", destination: "جورجيا", travel_start: "2026-11-02" }];
    const files = [{ serial: "AD-5-1", destination: "تركيا", phones: [null, "+966 55 123 4567"] }];
    expect(sameClientTrips("0551234567", trips, files)).toEqual(["له رحلة مسجّلة هنا: جورجيا — 2026-11-02", "له ملف مؤكد في العمليات: AD-5-1 — تركيا"]);
    expect(sameClientTrips("0551234567", trips, [], "t1")).toEqual([]);
    expect(sameClientTrips("0551", trips, files)).toEqual([]);
  });
});

describe("«@#@#@#»: the employee followed it, no reminder (the owner, 2026-10-29)", () => {
  it("the token anywhere in the note marks it; nothing else does", () => {
    expect(marksFollowed("تواصلت مع العميل بالهاتف @#@#@#")).toBe(true);
    expect(marksFollowed("@#@#@")).toBe(false);
    expect(marksFollowed(null)).toBe(false);
  });
  it("only a mark at or after what the reminder is about silences it", () => {
    const waiting = Date.parse("2026-10-29T08:00:00Z");
    expect(followedSince("2026-10-29T08:30:00Z", waiting)).toBe(true);
    expect(followedSince("2026-10-29T08:00:00Z", waiting)).toBe(true);
    expect(followedSince("2026-10-29T07:59:00Z", waiting)).toBe(false);
    expect(followedSince(null, waiting)).toBe(false);
    expect(followedSince("not a date", waiting)).toBe(false);
  });
});

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
