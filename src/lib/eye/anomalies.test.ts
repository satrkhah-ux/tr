import { describe, expect, it } from "vitest";
import { anomalies, firstName, measuredTickets, requestCounts, teletelEmployees, ticketMinutes, ticketsFromLeads, type LeadForTicket } from "./anomalies";
import type { EyeSnapshot } from "./types";

/**
 * Every rule against an injected clock. «تذكرة بلا رد منذ ١٤ ساعة» turns true with
 * no write anywhere, so the test moves the clock, not the data — the same reason
 * signals.ts is built this way.
 */

const DAY = "2026-07-30";
const NOW = "2026-07-30T20:00:00Z";

function snap(over: Partial<EyeSnapshot> = {}): EyeSnapshot {
  return {
    employees: [],
    tickets: [],
    audit: [],
    offers: [],
    bookings: [],
    ops: { liveCases: 0, needsAction: 0, critical: 0, openBookings: 0, travelSoon: 0, urgent: [] },
    ...over,
  };
}

const ticket = (over: Partial<EyeSnapshot["tickets"][number]> = {}) => ({
  id: "t1",
  subject: "استفسار",
  customer: "عميل",
  employee_id: "e1",
  employee_name: "ريم",
  created_at: "2026-07-30T04:00:00Z",
  responded_at: null,
  ...over,
});

describe("unanswered tickets", () => {
  it("stays quiet under the threshold", () => {
    const notes = anomalies(snap({ tickets: [ticket({ created_at: "2026-07-30T14:00:00Z" })] }), NOW, DAY);
    expect(notes.filter((n) => n.code === "ticket_unanswered")).toHaveLength(0);
  });

  it("fires past it, and escalates at double", () => {
    const warn = anomalies(snap({ tickets: [ticket({ created_at: "2026-07-30T06:00:00Z" })] }), NOW, DAY);
    expect(warn[0].code).toBe("ticket_unanswered");
    expect(warn[0].severity).toBe("warn");

    const critical = anomalies(snap({ tickets: [ticket({ created_at: "2026-07-29T18:00:00Z" })] }), NOW, DAY);
    expect(critical[0].severity).toBe("critical");
  });

  it("counts a long wait in days once hours stop being readable", () => {
    const notes = anomalies(snap({ tickets: [ticket({ created_at: "2026-07-10T20:00:00Z" })] }), NOW, DAY);
    expect(notes[0].title).toBe("تذكرة بلا رد منذ 20 يوم");
  });

  it("says nothing about a ticket that WAS answered, however slowly", () => {
    const notes = anomalies(
      snap({ tickets: [ticket({ created_at: "2026-07-28T00:00:00Z", responded_at: "2026-07-30T19:00:00Z" })] }),
      NOW,
      DAY,
    );
    expect(notes.some((n) => n.code === "ticket_unanswered")).toBe(false);
  });

  it("measures an open ticket against now, a closed one against its reply", () => {
    expect(ticketMinutes({ created_at: "2026-07-30T19:00:00Z", responded_at: null }, NOW)).toBe(60);
    expect(
      ticketMinutes({ created_at: "2026-07-30T10:00:00Z", responded_at: "2026-07-30T10:30:00Z" }, NOW),
    ).toBe(30);
  });
});

describe("today's average reply time", () => {
  it("reports a pattern, not a single slow ticket", () => {
    const slow = [
      ticket({ id: "a", created_at: "2026-07-30T00:00:00Z", responded_at: "2026-07-30T09:00:00Z" }),
      ticket({ id: "b", created_at: "2026-07-30T01:00:00Z", responded_at: "2026-07-30T10:00:00Z" }),
    ];
    const notes = anomalies(snap({ tickets: slow }), NOW, DAY);
    expect(notes.some((n) => n.code === "slow_response")).toBe(true);

    const fast = [ticket({ id: "c", created_at: "2026-07-30T09:00:00Z", responded_at: "2026-07-30T09:20:00Z" })];
    expect(anomalies(snap({ tickets: fast }), NOW, DAY).some((n) => n.code === "slow_response")).toBe(false);
  });

  it("ignores replies that happened on another day", () => {
    const yesterday = [ticket({ created_at: "2026-07-28T00:00:00Z", responded_at: "2026-07-29T12:00:00Z" })];
    expect(anomalies(snap({ tickets: yesterday }), NOW, DAY).some((n) => n.code === "slow_response")).toBe(false);
  });
});

describe("attendance", () => {
  const employee = (over: Partial<EyeSnapshot["employees"][number]> = {}) => ({
    id: "e1",
    name: "محمد",
    active: true,
    section: "المبيعات",
    first_seen_at: "2026-07-30T06:00:00Z",
    last_seen_at: "2026-07-30T14:00:00Z",
    beats: 40,
    actions_today: 3,
    ...over,
  });

  it("names who never opened the system", () => {
    const notes = anomalies(snap({ employees: [employee({ first_seen_at: null, last_seen_at: null, beats: 0 })] }), NOW, DAY);
    expect(notes.some((n) => n.code === "absent_today")).toBe(true);
  });

  // A holiday is one fact. Twelve identical notes bury every real one.
  it("collapses a day nobody opened the system into a single note", () => {
    const away = { first_seen_at: null, last_seen_at: null, beats: 0 };
    const notes = anomalies(
      snap({ employees: [employee({ id: "a", name: "محمد", ...away }), employee({ id: "b", name: "ريم", ...away }), employee({ id: "c", name: "هاني", ...away })] }),
      NOW,
      DAY,
    );
    const absent = notes.filter((n) => n.code === "absent_today");
    expect(absent).toHaveLength(1);
    expect(absent[0].title).toBe("ما أحد فتح النظام اليوم");
  });

  it("still names them individually when only some are away", () => {
    const notes = anomalies(
      snap({ employees: [employee({ id: "a", name: "محمد" }), employee({ id: "b", name: "ريم", first_seen_at: null, last_seen_at: null, beats: 0 })] }),
      NOW,
      DAY,
    );
    const absent = notes.filter((n) => n.code === "absent_today");
    expect(absent).toHaveLength(1);
    expect(absent[0].title).toContain("ريم");
  });

  it("does not count an inactive colleague as absent", () => {
    const notes = anomalies(snap({ employees: [employee({ active: false, first_seen_at: null })] }), NOW, DAY);
    expect(notes).toHaveLength(0);
  });

  // Real work leaves no audit row all the time — a phone call, a supplier chat.
  it("mentions a day with no recorded action only as information", () => {
    const notes = anomalies(snap({ employees: [employee({ actions_today: 0 })] }), NOW, DAY);
    expect(notes[0].code).toBe("no_activity");
    expect(notes[0].severity).toBe("info");
  });

  it("says nothing about someone who barely opened it and did nothing", () => {
    const notes = anomalies(snap({ employees: [employee({ actions_today: 0, beats: 2 })] }), NOW, DAY);
    expect(notes).toHaveLength(0);
  });
});

describe("the audit trail", () => {
  it("always surfaces a passport read — and never the number", () => {
    const notes = anomalies(
      snap({
        audit: [
          {
            action: "passport.viewed",
            actor_id: "u1",
            actor_name: "هاني",
            entity_id: "trav-1",
            created_at: "2026-07-30T11:20:00Z",
            meta: null,
          },
        ],
      }),
      NOW,
      DAY,
    );
    const note = notes.find((n) => n.code === "passport_read");
    expect(note?.title).toContain("هاني");
    expect(JSON.stringify(notes)).not.toMatch(/\d{6,}/); // no identifier-looking number
  });

  it("flags a widened section", () => {
    const notes = anomalies(
      snap({
        audit: [
          {
            action: "role.updated",
            actor_id: "u1",
            actor_name: "أدمن",
            entity_id: "role-1",
            created_at: "2026-07-30T09:00:00Z",
            meta: { permissions: ["a", "b", "c"] },
          },
        ],
      }),
      NOW,
      DAY,
    );
    expect(notes.find((n) => n.code === "permission_widened")?.detail).toBe("3 صلاحية");
  });

  it("ignores yesterday's entries", () => {
    const notes = anomalies(
      snap({ audit: [{ action: "passport.viewed", actor_id: "u", actor_name: "س", entity_id: "x", created_at: "2026-07-29T11:00:00Z", meta: null }] }),
      NOW,
      DAY,
    );
    expect(notes).toHaveLength(0);
  });
});

describe("a confirmation that disappeared", () => {
  it("catches a booking still holding a confirmation number in a pending state", () => {
    const notes = anomalies(
      snap({
        bookings: [
          { id: "b1", operation_id: "o1", title: "فندق باكو", status: "pending", confirmed_at: "2026-07-29T02:00:00Z", confirmation_number: "121212" },
        ],
      }),
      NOW,
      DAY,
    );
    expect(notes.find((n) => n.code === "booking_regressed")?.detail).toContain("121212");
  });

  it("leaves a properly confirmed or cancelled booking alone", () => {
    const rows = [
      { id: "b1", operation_id: "o1", title: "أ", status: "confirmed", confirmed_at: "x", confirmation_number: "1" },
      { id: "b2", operation_id: "o1", title: "ب", status: "cancelled", confirmed_at: "x", confirmation_number: "2" },
    ];
    expect(anomalies(snap({ bookings: rows }), NOW, DAY)).toHaveLength(0);
  });
});

describe("ordering", () => {
  it("puts what is critical first", () => {
    const notes = anomalies(
      snap({
        tickets: [ticket({ created_at: "2026-07-30T06:00:00Z" })], // warn
        employees: [{ id: "e", name: "س", active: true, section: null, first_seen_at: null, last_seen_at: null, beats: 0, actions_today: 0 }], // info
        ops: { liveCases: 1, needsAction: 1, critical: 1, openBookings: 0, travelSoon: 1, urgent: [{ id: "o1", serial: "AD-1", customer: "ع", worst: "السفر يقترب" }] },
      }),
      NOW,
      DAY,
    );
    expect(notes.map((n) => n.severity)).toEqual(["critical", "warn", "info"]);
  });
});

describe("a quiet day", () => {
  it("says nothing at all", () => {
    expect(anomalies(snap(), NOW, DAY)).toEqual([]);
  });
});

describe("the conversations of «العملاء» as tickets (care_tickets is empty since 2026-10-19)", () => {
  const lead = (over: Partial<LeadForTicket> = {}): LeadForTicket => ({
    id: "l1",
    name: "محمد العتيبي",
    inquiry: "بكج",
    status: "open",
    assigned_to: null,
    assigned_to_name: null,
    received_by: "e1",
    received_by_name: "ريم",
    first_message_at: "2026-07-30T06:00:00Z",
    first_reply_at: null,
    ...over,
  });

  it("measures the client's first message to our first reply", () => {
    const [t] = ticketsFromLeads([lead({ first_reply_at: "2026-07-30T06:20:00Z" })], new Map());
    expect(ticketMinutes(t, NOW)).toBe(20);
    expect(t.subject).toBe("بكج");
  });

  it("raises the same note a ticket did, with the client's first name only", () => {
    const notes = anomalies(snap({ tickets: ticketsFromLeads([lead()], new Map([["e1", "ريم الحربي"]])) }), NOW, DAY);
    expect(notes[0].code).toBe("ticket_unanswered");
    expect(notes[0].title).toBe("تذكرة بلا رد منذ 14 ساعة");
    expect(notes[0].detail).toBe("بكج · محمد · ريم الحربي");
  });

  it("leaves the exempt colleagues' tickets out of what is measured (لا يُحسب عليهم تأخير)", () => {
    const rows = [lead({ id: "desk", received_by: "e1" }), lead({ id: "other", received_by: "e2", received_by_name: "هاني" }), lead({ id: "nobody", received_by: null, received_by_name: null })];
    const tickets = ticketsFromLeads(rows, new Map());
    expect(measuredTickets(tickets, new Set(["e1"])).map((t) => t.id)).toEqual(["other", "nobody"]);
    // nobody exempt: every ticket, as before
    expect(measuredTickets(tickets, new Set())).toEqual(tickets);
    expect(measuredTickets(tickets)).toEqual(tickets);
    // and a 14-hour wait of the exempt desk raises no note
    expect(anomalies(snap({ tickets: measuredTickets(ticketsFromLeads([lead({ received_by: "e1" })], new Map()), new Set(["e1"])) }), NOW, DAY).some((n) => n.code === "ticket_unanswered")).toBe(false);
    expect(anomalies(snap({ tickets: measuredTickets(ticketsFromLeads([lead({ received_by: "e1" })], new Map()), new Set(["e2"])) }), NOW, DAY).some((n) => n.code === "ticket_unanswered")).toBe(true);
  });

  it("names whoever it was handed to before whoever received it", () => {
    const [t] = ticketsFromLeads([lead({ assigned_to: "e2", assigned_to_name: "هاني" })], new Map());
    expect(t.employee_id).toBe("e2");
    expect(t.employee_name).toBe("هاني");
  });

  it("skips a row without the system's clock, one whose reply predates it, and one resolved without a reply", () => {
    const rows = [
      lead({ id: "sheet", first_message_at: null }),
      lead({ id: "resolved", status: "closed" }),
      // Teletel's «first reply» from an earlier conversation of the same client
      lead({ id: "borrowed", first_reply_at: "2026-07-01T07:00:00Z" }),
      lead({ id: "answered", status: "closed", first_reply_at: "2026-07-30T07:00:00Z" }),
    ];
    expect(ticketsFromLeads(rows, new Map()).map((t) => t.id)).toEqual(["answered"]);
  });

  it("never passes on a phone or Teletel's «#id» as a name", () => {
    expect(firstName("966501234567")).toBeNull();
    expect(firstName("+966 50")).toBeNull();
    expect(firstName("#4521")).toBeNull();
    expect(firstName("٠٥٠١٢٣")).toBeNull();
    expect(firstName("  سارة   القحطاني ")).toBe("سارة");
    expect(firstName(null)).toBeNull();
  });
});

describe("absence, for those who work in the system only (the owner, 2026-10-19)", () => {
  const person = (over: Partial<EyeSnapshot["employees"][number]> = {}) => ({
    id: "e1",
    name: "محمد",
    active: true,
    section: "مبيعات",
    first_seen_at: null,
    last_seen_at: null,
    beats: 0,
    actions_today: 0,
    ...over,
  });

  it("says nothing about a Teletel agent who never opened the system", () => {
    const notes = anomalies(snap({ employees: [person({ works_in_teletel: true }), person({ id: "e2", name: "ريم", section: "العمليات" })] }), NOW, DAY);
    expect(notes.map((n) => n.title)).toEqual(["ريم ما فتح النظام اليوم"]);
  });

  it("counts «nobody opened it» among the system's own users only", () => {
    const notes = anomalies(
      snap({ employees: [person({ works_in_teletel: true }), person({ id: "e2", name: "ريم" }), person({ id: "e3", name: "هاني" })] }),
      NOW,
      DAY,
    );
    expect(notes.map((n) => n.title)).toEqual(["ما أحد فتح النظام اليوم"]);
    expect(notes[0].detail).toContain("2 موظف");
  });

  it("knows a Teletel agent by their name, its first words, or the same name with words left out", () => {
    const staff = [
      { id: "a", arabic_name: "احمد يوسف" },
      { id: "b", arabic_name: "رشا العتيبي" },
      { id: "c", arabic_name: "هاني" },
      { id: "d", arabic_name: "احمد يوسف حيدر القدسي" },
      { id: "e", arabic_name: "عبد الرزاق" },
    ];
    expect([...teletelEmployees(["احمد يوسف", "رشا", "مهندس خالد", "احمد القدسي", "عبد الرزاق الزلب", "هاني سعيد"], staff)].sort()).toEqual(["a", "b", "d", "e"]);
  });
});

describe("the admin dashboard's request tiles (data/metrics.ts)", () => {
  it("counts the answered, who has any, and who still owes a reply", () => {
    const t = (id: string, employee_id: string | null, responded_at: string | null) => ({ id, subject: "بكج", customer: null, employee_id, employee_name: null, created_at: NOW, responded_at });
    const c = requestCounts([t("1", "e1", NOW), t("2", "e1", null), t("3", "e2", NOW), t("4", null, null)]);
    expect(c.answered).toBe(2);
    expect([...c.assigned].sort()).toEqual(["e1", "e2"]);
    expect([...c.pending]).toEqual(["e1"]);
  });
});
