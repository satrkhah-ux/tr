/**
 * The rules that decide what is worth telling management.
 *
 * Pure and clock-injected, exactly like signals.ts — which is the only reason
 * every one of them is testable: «تذكرة بلا رد منذ ١٤ ساعة» becomes true with no
 * write anywhere, so a test has to be able to move the clock rather than the data.
 *
 * The bar for a rule to exist here: it must name something a manager would ACT on.
 * "17 offers exist" is not a note. "A ticket has been open 14 hours" is.
 */

import { fold, matchEmployee } from "@/lib/leads/sheet";
import type { EyeSnapshot, Note, NoteSeverity } from "./types";

/** A ticket left this long without a reply is a complaint in the making. */
export const TICKET_STALE_HOURS = 12;
/** Today's average reply time above this is a pattern, not one slow ticket. */
export const SLOW_AVERAGE_MINUTES = 240;
/** An offer sitting unpriced this long has stalled. */
export const UNPRICED_DAYS = 2;

const SEVERITY_RANK: Record<NoteSeverity, number> = { critical: 0, warn: 1, info: 2 };

function hoursBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b - a) / 3_600_000;
}

function sameDay(iso: string, day: string): boolean {
  return iso.slice(0, 10) === day;
}

/**
 * How old, said the way a person would say it.
 *
 * «تذكرة بلا رد منذ 475 ساعة» is arithmetic, not language — nobody counts past
 * two days in hours, and a number that large stops registering as urgent
 * precisely when it is most urgent. Past two days this switches to days.
 */
export function agePhrase(hours: number): string {
  if (hours < 48) return arCount(Math.floor(hours), "ساعة", "ساعتين", "ساعات");
  return arCount(Math.floor(hours / 24), "يوم", "يومين", "أيام");
}

/** Arabic counting with digits: 1 ساعة, ساعتين, 3–10 ساعات, 11+ ساعة (the evaluator, 2026-10-20: «منذ 9 ساعة» read wrong). */
export function arCount(n: number, one: string, two: string, few: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${one}`;
}

/** Minutes a ticket took, or is taking. */
export function ticketMinutes(ticket: { created_at: string; responded_at: string | null }, now: string): number | null {
  const hours = hoursBetween(ticket.created_at, ticket.responded_at ?? now);
  return hours == null ? null : Math.round(hours * 60);
}

/**
 * A client as a shared screen or a briefing may name them: the first word, and
 * never a phone number or Teletel's «#123» stand-in (a contact without a name
 * is listed by its number).
 */
export function firstName(name: string | null | undefined): string | null {
  const word = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return word && !/[\d٠-٩۰-۹#+@]/.test(word) ? word : null;
}

/**
 * The admin dashboard's request tiles (data/metrics.ts) from the same tickets:
 * how many were answered, who has any, and who has one still unanswered.
 */
export function requestCounts(tickets: EyeSnapshot["tickets"]): { answered: number; assigned: Set<string>; pending: Set<string> } {
  const assigned = new Set<string>();
  const pending = new Set<string>();
  let answered = 0;
  for (const t of tickets) {
    if (t.responded_at) answered += 1;
    if (!t.employee_id) continue;
    assigned.add(t.employee_id);
    if (!t.responded_at) pending.add(t.employee_id);
  }
  return { answered, assigned, pending };
}

/**
 * The employees who are Teletel agents: an agent's name is theirs, or its first
 * words are (sheet.ts matchEmployee) — or the shorter of the two names, two
 * words at least, is the longer one's with words left out, for one employee
 * only (Teletel's «احمد القدسي» is «احمد يوسف حيدر القدسي» in the system).
 */
export function teletelEmployees(agentNames: string[], employees: { id: string; arabic_name: string }[]): Set<string> {
  const words = (s: string) => s.trim().split(/\s+/).map(fold).filter(Boolean);
  // `small` read in order inside `big`
  const within = (small: string[], big: string[]) => {
    let i = 0;
    for (const w of big) if (w === small[i]) i += 1;
    return i === small.length;
  };
  const out = new Set<string>();
  for (const name of agentNames) {
    const exact = matchEmployee(name, employees);
    if (exact) {
      out.add(exact);
      continue;
    }
    const a = words(name);
    const loose = employees.filter((e) => {
      const b = words(e.arabic_name);
      const [small, big] = a.length <= b.length ? [a, b] : [b, a];
      return small.length >= 2 && within(small, big);
    });
    if (loose.length === 1) out.add(loose[0].id);
  }
  return out;
}

/** The client_leads columns a LeadForTicket is read with. */
export const LEAD_TICKET_COLS = "id, name, inquiry, status, assigned_to, assigned_to_name, received_by, received_by_name, first_message_at, first_reply_at";

/** A conversation of «العملاء» (client_leads), as much of it as the response rules read. */
export type LeadForTicket = {
  id: string;
  name: string | null;
  inquiry: string | null;
  status: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  received_by: string | null;
  received_by_name: string | null;
  first_message_at: string | null;
  first_reply_at: string | null;
};

/**
 * The client conversations as the «tickets» the response rules measure — since
 * the menu consolidation (2026-10-19) care_tickets is empty and «العملاء» is
 * where clients wait. The clock is the system's own (0098): the client's first
 * message and our first reply, written by the Teletel pull. A row without them
 * (the sheet's phase one) has no clock and is not measured; nor is one whose
 * «first reply» came before the message (Teletel handed over an earlier
 * conversation's — two such rows on 2026-10-19); a conversation closed without
 * a reply was resolved in Teletel and keeps nobody waiting.
 */
export function ticketsFromLeads(leads: LeadForTicket[], nameOf: ReadonlyMap<string, string>): EyeSnapshot["tickets"] {
  return leads
    .filter((l) => l.first_message_at && (l.first_reply_at || l.status !== "closed"))
    .filter((l) => !l.first_reply_at || Date.parse(l.first_reply_at) >= Date.parse(l.first_message_at!))
    .map((l) => {
      const employee = l.assigned_to ?? l.received_by;
      return {
        id: l.id,
        subject: l.inquiry || "محادثة",
        customer: firstName(l.name),
        employee_id: employee,
        employee_name: (employee ? nameOf.get(employee) : undefined) ?? l.assigned_to_name ?? l.received_by_name ?? null,
        created_at: l.first_message_at!,
        responded_at: l.first_reply_at,
      };
    });
}

/**
 * The tickets whose waiting is measured: the colleagues the administration exempted from lateness (app_settings
 * lateness_exempt, «لا يُحسب عليهم تأخير») have none of their tickets in the response figures and notes.
 */
export function measuredTickets(tickets: EyeSnapshot["tickets"], exemptEmployeeIds?: ReadonlySet<string>): EyeSnapshot["tickets"] {
  return exemptEmployeeIds?.size ? tickets.filter((t) => !t.employee_id || !exemptEmployeeIds.has(t.employee_id)) : tickets;
}

/**
 * Every note the snapshot raises, worst first.
 *
 * `now` is a full ISO instant (not a date) because the ticket rules measure hours;
 * `day` is the calendar day the report is for.
 */
export function anomalies(snapshot: EyeSnapshot, now: string, day: string): Note[] {
  const notes: Note[] = [];

  // ---- customer care: the delay a client actually feels ----
  for (const ticket of snapshot.tickets) {
    if (ticket.responded_at) continue;
    const hours = hoursBetween(ticket.created_at, now);
    if (hours == null || hours < TICKET_STALE_HOURS) continue;
    notes.push({
      code: "ticket_unanswered",
      severity: hours >= TICKET_STALE_HOURS * 2 ? "critical" : "warn",
      subject_kind: "ticket",
      subject_id: ticket.id,
      title: `تذكرة بلا رد منذ ${agePhrase(hours)}`,
      detail: [ticket.subject, ticket.customer, ticket.employee_name].filter(Boolean).join(" · "),
    });
  }

  const answeredToday = snapshot.tickets.filter((t) => t.responded_at && sameDay(t.responded_at, day));
  const durations = answeredToday
    .map((t) => ticketMinutes(t, now))
    .filter((m): m is number => m != null);
  if (durations.length > 0) {
    const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    if (avg > SLOW_AVERAGE_MINUTES) {
      notes.push({
        code: "slow_response",
        severity: "warn",
        subject_kind: "other",
        subject_id: day,
        title: `متوسط الرد اليوم ${avg} دقيقة`,
        detail: `على ${durations.length} تذكرة`,
      });
    }
  }

  // ---- attendance, said as what it measures ----
  //
  // Nobody at all is ONE fact, not twelve. A holiday, a weekend, or a server that
  // stopped recording produces twelve identical notes that bury every real one —
  // and twelve notes about one cause is how a report teaches people to skim it.
  //
  // Only for those who work IN the system: the sales team works in Teletel, and
  // «X ما فتح النظام اليوم» about them was the misleading note of 2026-10-19.
  // Teletel says who is online now, never who was there today — so for them
  // nothing is said rather than something wrong (works_in_teletel, report.ts).
  const expectedToday = snapshot.employees.filter((e) => e.active && !e.works_in_teletel);
  const absentToday = expectedToday.filter((e) => !e.first_seen_at);
  if (expectedToday.length > 1 && absentToday.length === expectedToday.length) {
    notes.push({
      code: "absent_today",
      severity: "info",
      subject_kind: "other",
      subject_id: day,
      title: "ما أحد فتح النظام اليوم",
      detail: `${expectedToday.length} موظف — إجازة، أو النظام ما اُستخدم`,
    });
  }

  for (const employee of snapshot.employees) {
    if (!employee.active) continue;
    if (!employee.first_seen_at) {
      if (employee.works_in_teletel) continue;
      // already said collectively above
      if (absentToday.length === expectedToday.length && expectedToday.length > 1) continue;
      notes.push({
        code: "absent_today",
        severity: "info",
        subject_kind: "employee",
        subject_id: employee.id,
        title: `${employee.name} ما فتح النظام اليوم`,
        detail: employee.section ?? undefined,
      });
      continue;
    }
    // Present but left no trace: worth noticing, not worth accusing — plenty of
    // real work (a phone call, a supplier chat) leaves no audit row.
    if (employee.actions_today === 0 && employee.beats > 4) {
      notes.push({
        code: "no_activity",
        severity: "info",
        subject_kind: "employee",
        subject_id: employee.id,
        title: `${employee.name} فتح النظام بدون أي إجراء مسجّل`,
      });
    }
  }

  // ---- operations: reuse the board's own judgement ----
  for (const urgent of snapshot.ops.urgent) {
    notes.push({
      code: "ops_critical",
      severity: "critical",
      subject_kind: "operation",
      subject_id: urgent.id,
      title: urgent.customer ? `ملف ${urgent.customer} — ${urgent.serial}` : `ملف ${urgent.serial}`,
      detail: urgent.worst,
    });
  }

  // ---- a confirmation that quietly disappeared ----
  // The row still carries the supplier's number and the time it was confirmed,
  // yet its status says nobody has answered. That is the shape of a regression.
  for (const booking of snapshot.bookings) {
    if (booking.confirmed_at && booking.confirmation_number && booking.status !== "confirmed" && booking.status !== "cancelled") {
      notes.push({
        code: "booking_regressed",
        severity: "warn",
        subject_kind: "operation",
        subject_id: booking.id,
        title: `حجز «${booking.title}» يحمل رقم تأكيد وحالته «${booking.status}»`,
        detail: `رقم التأكيد ${booking.confirmation_number}`,
      });
    }
  }

  // ---- the audit trail: the two entries management always wants to see ----
  for (const entry of snapshot.audit) {
    if (!sameDay(entry.created_at, day)) continue;

    if (entry.action === "passport.viewed" || entry.action === "passport.scan_viewed") {
      notes.push({
        code: "passport_read",
        severity: "info",
        subject_kind: "employee",
        subject_id: `${entry.actor_id ?? "?"}:${entry.entity_id ?? "?"}`,
        // The NUMBER is never here — only that it was read, by whom.
        title: `${entry.actor_name ?? "مستخدم"} اطّلع على بيانات جواز`,
        detail: entry.created_at.slice(11, 16),
      });
    }

    if (entry.action === "role.updated" || entry.action === "role.created") {
      const count = Array.isArray(entry.meta?.["permissions"]) ? (entry.meta["permissions"] as unknown[]).length : null;
      notes.push({
        code: "permission_widened",
        severity: "warn",
        subject_kind: "role",
        subject_id: entry.entity_id ?? "?",
        title: `${entry.actor_name ?? "مستخدم"} عدّل صلاحيات قسم`,
        detail: count != null ? `${count} صلاحية` : undefined,
      });
    }
  }

  // ---- an offer that stalled before it had a price ----
  for (const offer of snapshot.offers) {
    if (offer.status !== "draft" || offer.total != null) continue;
    const hours = hoursBetween(offer.created_at, now);
    if (hours == null || hours < UNPRICED_DAYS * 24) continue;
    notes.push({
      code: "offer_unpriced",
      severity: "info",
      subject_kind: "offer",
      subject_id: offer.serial,
      title: `عرض ${offer.serial} بلا تسعير منذ ${Math.floor(hours / 24)} يوم`,
    });
  }

  return notes.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
