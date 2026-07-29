/**
 * The operations panel on the dashboard, as numbers.
 *
 * Pure and clock-injected for the same reason signals.ts is: "travelling within
 * the week" turns true with no UPDATE anywhere, so a test has to be able to move
 * the date. Counting lives here rather than inside the server action so it can be
 * checked without a database.
 *
 * Every field answers a question an ops agent asks before opening anything:
 * how many cases are live, how many are shouting, how many bookings are still
 * open, how much money has not arrived.
 */

import { daysBetween } from "@/lib/offer/invariants";
import { TRAVEL_SOON_DAYS, type OperationSignal } from "./signals";
import type { ClientStatus, ExecutionStatus } from "./state";

export type OpsCase = {
  client_status: ClientStatus;
  execution_status: ExecutionStatus;
  travel_start: string | null;
  total: number | null;
  paid: number;
  currency: string | null;
  bookings: { id: string; status: string }[];
  signals: OperationSignal[];
};

export type MoneyBucket = { currency: string; amount: number };

export type OpsCounts = {
  liveCases: number;
  needsAction: number;
  critical: number;
  openBookings: number;
  vouchersPending: number;
  travelSoon: number;
  /**
   * One bucket per currency, biggest first. NOT one number: summing SAR and USD
   * would print a total that is true in no currency at all.
   */
  outstanding: MoneyBucket[];
};

/** Requested / re-priced / mid-flight — a supplier has not come back yet. */
const OPEN_BOOKING: ReadonlySet<string> = new Set(["pending", "prebooked", "in_flight"]);

/** A case still being worked. Cancelled is history; travelled is done. */
export function isLiveCase(c: Pick<OpsCase, "client_status" | "execution_status">): boolean {
  return (
    c.client_status !== "cancelled" && c.execution_status !== "cancelled" && c.execution_status !== "travelled"
  );
}

export function summarizeOperations(cases: OpsCase[], today: string): OpsCounts {
  const live = cases.filter(isLiveCase);
  const outstanding = new Map<string, number>();
  let openBookings = 0;
  let vouchersPending = 0;
  let travelSoon = 0;

  for (const c of live) {
    for (const b of c.bookings) if (OPEN_BOOKING.has(b.status)) openBookings += 1;

    // Read off the signal rather than recomputing: "which booking still needs a
    // document" is a rule with real subtleties (combined vouchers, stale ones),
    // and two copies of it would drift and make the tile disagree with the board.
    vouchersPending += c.signals.find((s) => s.code === "vouchers_pending")?.subjects.length ?? 0;

    if (c.travel_start) {
      const days = daysBetween(today, c.travel_start);
      if (days != null && days >= 0 && days <= TRAVEL_SOON_DAYS) travelSoon += 1;
    }

    // Refunds are already netted into `paid` upstream, so a negative remainder
    // means the client overpaid — money to return, not money to chase.
    if (c.total != null && c.total > c.paid) {
      const key = c.currency ?? "SAR";
      outstanding.set(key, (outstanding.get(key) ?? 0) + (c.total - c.paid));
    }
  }

  return {
    liveCases: live.length,
    needsAction: live.filter((c) => c.signals.length > 0).length,
    critical: live.filter((c) => c.signals.some((s) => s.severity === "critical")).length,
    openBookings,
    vouchersPending,
    travelSoon,
    outstanding: [...outstanding.entries()]
      .map(([currency, amount]) => ({ currency, amount }))
      .sort((a, b) => b.amount - a.amount),
  };
}
