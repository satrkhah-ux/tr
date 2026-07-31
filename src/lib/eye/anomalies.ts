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
  if (hours < 48) return `${Math.floor(hours)} ساعة`;
  return `${Math.floor(hours / 24)} يوم`;
}

/** Minutes a ticket took, or is taking. */
export function ticketMinutes(ticket: { created_at: string; responded_at: string | null }, now: string): number | null {
  const hours = hoursBetween(ticket.created_at, ticket.responded_at ?? now);
  return hours == null ? null : Math.round(hours * 60);
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
  const expectedToday = snapshot.employees.filter((e) => e.active);
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
