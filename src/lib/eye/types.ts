/**
 * What «عين الإدارة» looks at, and what it says about it.
 *
 * Pure types — no Supabase, no React. The snapshot is deliberately NOT a set of
 * database rows: it is the handful of facts the rules need, so every rule can be
 * tested by writing four lines of literal instead of standing up a database.
 */

export type NoteSeverity = "critical" | "warn" | "info";

export type NoteCode =
  | "ticket_unanswered"
  | "slow_response"
  | "absent_today"
  | "no_activity"
  | "ops_critical"
  | "booking_regressed"
  | "passport_read"
  | "permission_widened"
  | "offer_unpriced";

export type Note = {
  code: NoteCode;
  severity: NoteSeverity;
  /** who or what this is about — part of the note's identity, so a repeat updates. */
  subject_kind: "employee" | "ticket" | "operation" | "offer" | "role" | "other";
  subject_id: string;
  title: string;
  detail?: string;
};

// ---------- the facts the rules read ----------

export type EyeEmployee = {
  id: string;
  name: string;
  /** false → not counted as absent; they are not expected. */
  active: boolean;
  section: string | null;
  /** null = never opened the system today. */
  first_seen_at: string | null;
  last_seen_at: string | null;
  beats: number;
  /** entries in audit_logs attributed to them today. */
  actions_today: number;
};

export type EyeTicket = {
  id: string;
  subject: string;
  customer: string | null;
  employee_id: string | null;
  employee_name: string | null;
  created_at: string;
  responded_at: string | null;
};

export type EyeAuditEntry = {
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  entity_id: string | null;
  created_at: string;
  meta: Record<string, unknown> | null;
};

export type EyeOffer = {
  serial: string;
  status: string;
  total: number | null;
  created_at: string;
};

export type EyeBooking = {
  id: string;
  operation_id: string;
  title: string;
  status: string;
  /** a confirmation was recorded at some point... */
  confirmed_at: string | null;
  /** ...and the confirmation number is still on the row. */
  confirmation_number: string | null;
};

/** The operations picture, taken from the same digest the ops bot sends. */
export type EyeOps = {
  liveCases: number;
  needsAction: number;
  critical: number;
  openBookings: number;
  travelSoon: number;
  urgent: { id: string; serial: string; customer: string | null; worst: string }[];
};

export type EyeSnapshot = {
  employees: EyeEmployee[];
  tickets: EyeTicket[];
  audit: EyeAuditEntry[];
  offers: EyeOffer[];
  bookings: EyeBooking[];
  ops: EyeOps;
};

// ---------- what comes out ----------

export type EyeReport = {
  day: string;
  attendance: {
    expected: number;
    present: number;
    absent: string[];
    /** name → «من HH:mm إلى HH:mm» */
    windows: { name: string; from: string; to: string; minutes: number }[];
  };
  response: {
    opened: number;
    answered: number;
    unanswered: number;
    avgMinutes: number | null;
    worstMinutes: number | null;
    worstSubject: string | null;
  };
  ops: EyeOps;
  sales: {
    issuedToday: number;
    confirmedToday: number;
    /** issued today, in the display currency of each — summed per currency upstream. */
    totalToday: number | null;
    currency: string;
  };
  activity: { name: string; count: number }[];
  notes: Note[];
};
