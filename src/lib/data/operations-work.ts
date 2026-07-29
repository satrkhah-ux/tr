"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentRole } from "@/lib/data/metrics";
import { can } from "@/lib/roles/roles";
import { listOperations, type OperationCard } from "@/lib/data/operations";
import { listTravelersByOperation } from "@/lib/data/operation-travelers";
import { operationSignals, severityRank, type OperationSignal, type OperationSnapshot } from "@/lib/operations/signals";
import { isLiveCase, summarizeOperations, type OpsCase, type OpsCounts } from "@/lib/operations/summary";
import type { ExecutionStatus } from "@/lib/operations/state";

/**
 * One loader behind both operations views: the board and the dashboard panel.
 *
 * It exists because the board used to compute its signals against EMPTY bookings
 * and documents — so «فندق بانتظار التأكيد» and «فاوتشر لم يصدر» could never fire,
 * and a board full of green cards meant nothing. It also loaded travelers one
 * operation at a time.
 *
 * Both are fixed here: four queries total, whatever the number of cases, and the
 * signals see the bookings they were written for.
 */

type BookingRow = {
  id: string;
  operation_id: string;
  kind: string;
  title: string;
  status: string;
  cancellation_deadline: string | null;
  confirmed_at: string | null;
};

type DocRow = { operation_id: string; kind: string; booking_id: string | null; created_at: string };

/** group-by that reads the same way twice. */
function byOperation<T extends { operation_id: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(row.operation_id);
    if (list) list.push(row);
    else out.set(row.operation_id, [row]);
  }
  return out;
}

export type OperationWork = OperationCard & { signals: OperationSignal[] };

type Loaded = { ok: boolean; items: OperationWork[]; cases: OpsCase[]; today: string };

async function load(): Promise<Loaded> {
  // The clock is read ONCE, on the server. Deriving "travel is approaching" in
  // the browser would make urgency depend on the visitor's device time, and two
  // agents on the same case would disagree about it.
  const today = new Date().toISOString().slice(0, 10);
  const closed: Loaded = { ok: false, items: [], cases: [], today };

  try {
    const user = await getServerUser();
    if (!user) return closed;
    if (!can(await getCurrentRole(), "operations.write")) return closed;

    const operations = await listOperations();
    if (operations.length === 0) return { ...closed, ok: true };

    const ids = operations.map((o) => o.id);
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;

    const [bookingsRes, docsRes, travelers] = await Promise.all([
      supabase
        .from("operation_bookings")
        .select("id, operation_id, kind, title, status, cancellation_deadline, confirmed_at")
        .in("operation_id", ids),
      // Revoked documents do not count as issued — that is the whole point of
      // revoking one. `created_at` is what tells a voucher printed BEFORE this
      // booking was confirmed from one that actually carries it.
      supabase
        .from("operation_documents")
        .select("operation_id, kind, booking_id, created_at")
        .is("revoked_at", null)
        .in("operation_id", ids),
      listTravelersByOperation(ids),
    ]);

    const bookings = byOperation((bookingsRes.data ?? []) as BookingRow[]);
    const documents = byOperation((docsRes.data ?? []) as DocRow[]);

    const items: OperationWork[] = [];
    const cases: OpsCase[] = [];

    for (const op of operations) {
      const bs = bookings.get(op.id) ?? [];
      const ds = documents.get(op.id) ?? [];
      const ts = travelers[op.id] ?? [];

      const snapshot: OperationSnapshot = {
        client_status: op.client_status,
        execution_status: op.execution_status,
        travel_start: op.travel_start,
        total: op.total,
        paid: op.paid,
        bookings: bs.map((b) => ({
          id: b.id,
          kind: b.kind,
          title: b.title,
          status: b.status,
          cancellation_deadline: b.cancellation_deadline,
          confirmed_at: b.confirmed_at,
        })),
        documents: ds.map((d) => ({ kind: d.kind, booking_id: d.booking_id, created_at: d.created_at })),
        travelers: ts.map((t) => ({ display_name: t.display_name, passport_expiry: t.passport_expiry })),
      };

      const signals = operationSignals(snapshot, today);
      items.push({ ...op, signals });
      cases.push({
        client_status: op.client_status,
        execution_status: op.execution_status,
        travel_start: op.travel_start,
        total: op.total,
        paid: op.paid,
        currency: op.currency,
        bookings: bs.map((b) => ({ id: b.id, status: b.status })),
        signals,
      });
    }

    return { ok: true, items, cases, today };
  } catch {
    return closed;
  }
}

/** The board: every operation with its signals already derived. */
export async function listOperationWork(): Promise<{ items: OperationWork[]; today: string }> {
  const { items, today } = await load();
  return { items, today };
}

export type UrgentCase = {
  id: string;
  serial: string;
  customer_name: string | null;
  destination: string | null;
  travel_start: string | null;
  execution_status: ExecutionStatus;
  signals: OperationSignal[];
};

export type OpsSummary = OpsCounts & {
  /** false when the viewer holds no operations permission — the panel hides itself. */
  ok: boolean;
  today: string;
  urgent: UrgentCase[];
};

/** How many cases the dashboard lists by name before it just gives counts. */
const URGENT_LIMIT = 6;

/**
 * The dashboard's operations panel.
 *
 * Small on purpose: counts plus the few cases worth naming. The board is one
 * click away and does the rest, so shipping every card to the home page would be
 * paying for a screen nobody reads there.
 */
export async function getOperationsSummary(): Promise<OpsSummary> {
  const { ok, items, cases, today } = await load();

  const urgent = items
    .filter((op) => isLiveCase(op) && op.signals.length > 0)
    .sort((a, b) => {
      const rank = severityRank(a.signals) - severityRank(b.signals);
      if (rank !== 0) return rank;
      return (a.travel_start ?? "9999").localeCompare(b.travel_start ?? "9999");
    })
    .slice(0, URGENT_LIMIT)
    .map((op) => ({
      id: op.id,
      serial: op.serial,
      customer_name: op.customer_name,
      destination: op.destination,
      travel_start: op.travel_start,
      execution_status: op.execution_status,
      signals: op.signals,
    }));

  return { ok, today, urgent, ...summarizeOperations(cases, today) };
}
