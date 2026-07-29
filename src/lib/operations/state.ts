/**
 * The two state machines behind «العمليات».
 *
 * They are deliberately INDEPENDENT. Merging "has the client paid" with "have we
 * booked the hotel" into one column is the mistake this module exists to prevent:
 * a client routinely pays in full while a hotel is still unconfirmed, and one
 * column cannot say that. Keeping them apart is what makes the board honest —
 * «مؤكّد ومسدّد · بانتظار تأكيد فندق» is a real state, not an error.
 *
 * Pure: no React, no Supabase, no clock. Safe to import anywhere.
 */

import { STAGE_KEYS, type StageKey } from "@/lib/data/pipeline";

/** The commercial relationship with the client. Order IS the machine. */
export const CLIENT_STATES = [
  "awaiting_reply",
  "confirmed",
  "paid_partial",
  "paid_full",
  "completed",
] as const;

/** The fulfilment work. Independent of the client track by decree. */
export const EXECUTION_STATES = [
  "pending_bookings",
  "flights_booked",
  "hotels_booked",
  "transfers_booked",
  "vouchers_issued",
  "ready_to_travel",
  "travelled",
] as const;

export type ClientStatus = (typeof CLIENT_STATES)[number] | "cancelled";
export type ExecutionStatus = (typeof EXECUTION_STATES)[number] | "cancelled";

/**
 * Forward-only movement along the order array.
 *
 * Why an ordering rule rather than a hand-written adjacency table: the execution
 * sequence is not truly linear in this business — hotels are often booked before
 * flights, and a package with no flights skips that state entirely. An adjacency
 * table would either forbid those real paths or grow into twenty hand-maintained
 * entries nobody keeps true. `index(to) > index(from)` permits skipping ahead
 * while still refusing every move that is actually wrong: going backwards,
 * standing still, resurrecting a cancelled case, or an unknown string.
 *
 * Terminality falls out of the same rule — the last element has no successor.
 */
function forward(order: readonly string[], from: string, to: string): boolean {
  if (from === to) return false;
  if (from === "cancelled") return false; // cancelled is terminal
  if (to === "cancelled") return true; // reachable from any live state
  const i = order.indexOf(from);
  const j = order.indexOf(to);
  return i >= 0 && j > i;
}

export function canAdvanceClient(from: ClientStatus, to: ClientStatus): boolean {
  return forward(CLIENT_STATES, from, to);
}

export function canAdvanceExecution(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return forward(EXECUTION_STATES, from, to);
}

export function isClientStatus(value: string): value is ClientStatus {
  return value === "cancelled" || (CLIENT_STATES as readonly string[]).includes(value);
}

export function isExecutionStatus(value: string): value is ExecutionStatus {
  return value === "cancelled" || (EXECUTION_STATES as readonly string[]).includes(value);
}

/**
 * The coarse kanban projection — the ONLY coupling between operations and the
 * existing board. Without it a card sits on «الطيران» while the operation says
 * the vouchers are out, and the board quietly becomes a lie.
 *
 * `cancelled` returns null: the caller leaves pipeline_stage untouched rather
 * than inventing a stage for a dead case.
 */
const EXECUTION_TO_STAGE: Record<(typeof EXECUTION_STATES)[number], StageKey> = {
  pending_bookings: "confirmed_hotels",
  hotels_booked: "confirmed_hotels",
  flights_booked: "flights",
  transfers_booked: "transportation",
  vouchers_issued: "completed",
  ready_to_travel: "completed",
  travelled: "completed",
};

export function kanbanStageFor(execution: ExecutionStatus): StageKey | null {
  if (execution === "cancelled") return null;
  const stage = EXECUTION_TO_STAGE[execution];
  // defensive: a stage key that is not in the board would silently vanish a card
  return STAGE_KEYS.includes(stage) ? stage : null;
}
