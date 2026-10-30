/**
 * «تحتاج إجراءً» — the signals that turn a list of operations into a board an
 * agent can work from.
 *
 * These are DERIVED, never stored. "Travel is approaching" flips true with no
 * UPDATE anywhere in the system, so materialising it as a column would need a
 * cron job to keep it honest. Deriving it costs one pass over rows already in
 * memory and is always true.
 *
 * Pure and clock-injected — `today` is a parameter, which is the only reason
 * every rule below is testable. Dates are compared as STRINGS, matching the
 * house rule already used by both rate-expiry gates.
 */

import { hotelFinal } from "./client-booking-state";
import { riyadhDay } from "./refund-mode";
import { passportExpiringWithin } from "./traveler-dto";
import { installmentStates, type Installment } from "./payments";
import type { ClientStatus, ExecutionStatus } from "./state";

export const TRAVEL_SOON_DAYS = 7;
export const PASSPORT_MONTHS = 6;
export const DEADLINE_WARN_DAYS = 3;

export type OperationSignalCode =
  | "unpaid_confirmed"
  | "hotel_awaiting_confirmation"
  | "vouchers_pending"
  | "travel_approaching_incomplete"
  | "passport_expiring"
  | "cancellation_deadline_near"
  | "installment_overdue";

export type SignalSeverity = "critical" | "warn" | "info";

export type OperationSignal = {
  code: OperationSignalCode;
  severity: SignalSeverity;
  /** what the signal is about — hotel names, traveler names. */
  subjects: string[];
};

/** Everything a signal may look at. Deliberately NOT a DB row. */
export type OperationSnapshot = {
  client_status: ClientStatus;
  execution_status: ExecutionStatus;
  travel_start: string | null;
  total: number | null;
  paid: number;
  bookings: {
    id: string;
    kind: string;
    title: string;
    status: string;
    cancellation_deadline: string | null;
    /** when the supplier's confirmation was recorded. Optional: unknown = lenient. */
    confirmed_at?: string | null;
    /** a hotel's number and ours — what tells the hotel's FINAL confirmation (hotelFinal). Optional: unknown = lenient. */
    confirmation_number?: string | null;
    company_ref?: string | null;
    /** paid to the supplier — a paid pay_by hold has nothing left to lose. Optional: unknown = unpaid. */
    is_paid?: boolean | null;
    /** detail.refund_mode (refund-mode.ts). Optional: unknown = the confirmed-only rule. */
    refund_mode?: string | null;
  }[];
  documents: { kind: string; booking_id: string | null; created_at?: string | null }[];
  travelers: { display_name: string; passport_expiry: string | null }[];
  /** the payment schedule in force — stored, else the default (payments.ts). Absent = not checked. */
  installments?: Installment[];
};

/** ISO date + N days, in UTC so a DST change never shifts the calendar day. */
function addDays(iso: string, days: number): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const LIVE_CLIENT: ClientStatus[] = ["confirmed", "paid_partial", "paid_full", "completed"];

/** Confirmed, and the money is not all in. */
export function unpaidConfirmed(op: OperationSnapshot): boolean {
  if (op.client_status === "cancelled" || op.client_status === "awaiting_reply") return false;
  if (op.total == null || op.total <= 0) return false;
  return op.paid < op.total;
}

/**
 * Hotels without their FINAL confirmation: requested or prebooked and never
 * back — or «confirmed» on our own number only, which the wizard's hotels step,
 * the voucher and the client's link do not count (client-booking-state hotelFinal).
 */
export function hotelAwaitingConfirmation(op: OperationSnapshot): string[] {
  const provisional = (b: SnapshotBooking) =>
    b.status === "confirmed" && b.confirmation_number !== undefined && !hotelFinal({ status: b.status, confirmation_number: b.confirmation_number, company_ref: b.company_ref });
  return op.bookings
    .filter((b) => b.kind === "hotel" && (b.status === "pending" || b.status === "prebooked" || b.status === "in_flight" || provisional(b)))
    .map((b) => b.title);
}

type SnapshotBooking = OperationSnapshot["bookings"][number];
type SnapshotDocument = OperationSnapshot["documents"][number];

/** Which document kinds actually carry a booking of this kind. */
function coveringKinds(bookingKind: string): string[] {
  if (bookingKind === "hotel") return ["hotel_voucher", "booking_summary"];
  if (bookingKind === "flight") return ["flight_ticket", "booking_summary"];
  return ["booking_summary"];
}

/**
 * Does a live document actually cover this booking?
 *
 * A document with NO booking_id is the combined voucher — the default the ops
 * team asked for — and it carries every booking of its kind. Treating only
 * per-booking documents as coverage would leave «فاوتشر لم يصدر» shouting forever
 * on a case whose voucher is already in the client's hands.
 *
 * The time test is what also catches the stale case: a hotel confirmed AFTER the
 * combined voucher was printed is not on that paper, so it still needs one.
 * Unknown timestamps are treated as covered — a signal that cannot be sure is
 * noise, and noise is what stops people reading signals.
 */
function documented(b: SnapshotBooking, documents: SnapshotDocument[]): boolean {
  const covering = coveringKinds(b.kind);
  return documents.some((d) => {
    if (d.booking_id != null) {
      if (d.booking_id !== b.id) return false;
    } else if (!covering.includes(d.kind)) {
      return false;
    }
    if (!b.confirmed_at || !d.created_at) return true;
    const issued = Date.parse(d.created_at);
    const confirmed = Date.parse(b.confirmed_at);
    if (Number.isNaN(issued) || Number.isNaN(confirmed)) return true;
    return issued >= confirmed;
  });
}

/** Confirmed bookings the traveller still has no valid document for. */
export function vouchersPending(op: OperationSnapshot): string[] {
  return op.bookings.filter((b) => b.status === "confirmed" && !documented(b, op.documents)).map((b) => b.title);
}

/** The trip starts within the week and something is still unbooked. */
export function travelApproachingIncomplete(op: OperationSnapshot, today: string): string[] {
  if (!op.travel_start || op.execution_status === "cancelled") return [];
  const limit = addDays(today, TRAVEL_SOON_DAYS);
  if (!limit) return [];
  if (op.travel_start > limit || op.travel_start < today) return [];
  return op.bookings.filter((b) => b.status !== "confirmed" && b.status !== "cancelled").map((b) => b.title);
}

/** Passports that will not survive the usual six-month rule. */
export function passportExpiring(op: OperationSnapshot, today: string): string[] {
  return op.travelers
    .filter((t) => passportExpiringWithin(t.passport_expiry, today, PASSPORT_MONTHS))
    .map((t) => t.display_name || "—");
}

/**
 * A confirmed booking whose free-cancellation window closes within days — or
 * a hold the hotel cancels unless we pay by its day (pay_by, the owner
 * 2026-10-30), whatever its status, until it is paid.
 *
 * This is the one signal that stops real money leaving: past the deadline a
 * cancellation costs a fee (or the room is gone), so it has to surface before
 * then, not after.
 */
export function cancellationDeadlineNear(op: OperationSnapshot, today: string): string[] {
  const limit = addDays(today, DEADLINE_WARN_DAYS);
  if (!limit) return [];
  return op.bookings
    .filter((b) => b.cancellation_deadline != null && b.status !== "cancelled")
    .filter((b) => (b.refund_mode === "pay_by" ? !b.is_paid : b.status === "confirmed"))
    .filter((b) => (riyadhDay(b.cancellation_deadline) ?? "") <= limit)
    .map((b) => b.title);
}

/** Installments past their due date that the money in so far does not cover — «date · amount still owed». */
export function installmentOverdue(op: OperationSnapshot, today: string): string[] {
  return installmentStates(op.installments ?? [], op.paid, today)
    .filter((r) => r.state === "overdue")
    .map((r) => `${r.due_date} · ${Math.round((r.amount - r.covered) * 100) / 100}`);
}

const SEVERITY: Record<OperationSignalCode, SignalSeverity> = {
  // red on the board: money the client promised by a date that has passed
  installment_overdue: "critical",
  travel_approaching_incomplete: "critical",
  cancellation_deadline_near: "critical",
  passport_expiring: "critical",
  hotel_awaiting_confirmation: "warn",
  unpaid_confirmed: "warn",
  vouchers_pending: "info",
};

const ORDER: OperationSignalCode[] = [
  "installment_overdue",
  "travel_approaching_incomplete",
  "cancellation_deadline_near",
  "passport_expiring",
  "hotel_awaiting_confirmation",
  "unpaid_confirmed",
  "vouchers_pending",
];

/** Every signal raised by one operation, most severe first. */
export function operationSignals(op: OperationSnapshot, today: string): OperationSignal[] {
  // A cancelled case raises nothing: it is not work, it is history.
  if (op.client_status === "cancelled" || op.execution_status === "cancelled") return [];

  const found = new Map<OperationSignalCode, string[]>();
  if (unpaidConfirmed(op)) found.set("unpaid_confirmed", []);
  const pairs: [OperationSignalCode, string[]][] = [
    ["hotel_awaiting_confirmation", hotelAwaitingConfirmation(op)],
    ["vouchers_pending", vouchersPending(op)],
    ["travel_approaching_incomplete", travelApproachingIncomplete(op, today)],
    ["passport_expiring", passportExpiring(op, today)],
    ["cancellation_deadline_near", cancellationDeadlineNear(op, today)],
    ["installment_overdue", installmentOverdue(op, today)],
  ];
  for (const [code, subjects] of pairs) if (subjects.length > 0) found.set(code, subjects);

  return ORDER.filter((code) => found.has(code)).map((code) => ({
    code,
    severity: SEVERITY[code],
    subjects: found.get(code) ?? [],
  }));
}

/** Board ordering: worst first, then by how soon the trip starts. */
export function severityRank(signals: OperationSignal[]): number {
  if (signals.some((s) => s.severity === "critical")) return 0;
  if (signals.some((s) => s.severity === "warn")) return 1;
  if (signals.length > 0) return 2;
  return 3;
}

export { LIVE_CLIENT };
