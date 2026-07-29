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

import { passportExpiringWithin } from "./traveler-dto";
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
  | "cancellation_deadline_near";

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
  }[];
  documents: { kind: string; booking_id: string | null }[];
  travelers: { display_name: string; passport_expiry: string | null }[];
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

/** Bookings that were requested or prebooked but never came back confirmed. */
export function hotelAwaitingConfirmation(op: OperationSnapshot): string[] {
  return op.bookings
    .filter((b) => b.kind === "hotel" && (b.status === "pending" || b.status === "prebooked" || b.status === "in_flight"))
    .map((b) => b.title);
}

/** Confirmed bookings with no voucher issued against them yet. */
export function vouchersPending(op: OperationSnapshot): string[] {
  const documented = new Set(op.documents.map((d) => d.booking_id).filter((id): id is string => Boolean(id)));
  return op.bookings.filter((b) => b.status === "confirmed" && !documented.has(b.id)).map((b) => b.title);
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
 * A confirmed booking whose free-cancellation window closes within days.
 *
 * This is the one signal that stops real money leaving: past the deadline a
 * cancellation costs a fee, so a case being quietly reconsidered has to surface
 * before then, not after.
 */
export function cancellationDeadlineNear(op: OperationSnapshot, today: string): string[] {
  const limit = addDays(today, DEADLINE_WARN_DAYS);
  if (!limit) return [];
  return op.bookings
    .filter((b) => b.status === "confirmed" && b.cancellation_deadline != null)
    .filter((b) => (b.cancellation_deadline as string).slice(0, 10) <= limit)
    .map((b) => b.title);
}

const SEVERITY: Record<OperationSignalCode, SignalSeverity> = {
  travel_approaching_incomplete: "critical",
  cancellation_deadline_near: "critical",
  passport_expiring: "critical",
  hotel_awaiting_confirmation: "warn",
  unpaid_confirmed: "warn",
  vouchers_pending: "info",
};

const ORDER: OperationSignalCode[] = [
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
