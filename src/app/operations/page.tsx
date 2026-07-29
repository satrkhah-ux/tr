import { OperationsBoard } from "@/components/traveliun/operations/OperationsBoard";
import { listConfirmableOffers, listOperations } from "@/lib/data/operations";
import { listTravelers } from "@/lib/data/operation-travelers";
import { operationSignals, type OperationSnapshot } from "@/lib/operations/signals";

export const dynamic = "force-dynamic";

/**
 * «العمليات» — the board.
 *
 * Signals are computed HERE, on the server, against one clock. Computing them in
 * the browser would make "travel is approaching" depend on the visitor's device
 * time, and two agents looking at the same case would disagree about whether it
 * is urgent.
 */
export default async function OperationsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [operations, confirmable] = await Promise.all([listOperations(), listConfirmableOffers()]);

  const withSignals = await Promise.all(
    operations.map(async (op) => {
      const travelers = await listTravelers(op.id);
      const snapshot: OperationSnapshot = {
        client_status: op.client_status,
        execution_status: op.execution_status,
        travel_start: op.travel_start,
        total: op.total,
        paid: op.paid,
        // bookings and documents arrive with migration 0025; until then the
        // booking-shaped signals simply find nothing, which is correct.
        bookings: [],
        documents: [],
        travelers: travelers.map((t) => ({ display_name: t.display_name, passport_expiry: t.passport_expiry })),
      };
      return { ...op, signals: operationSignals(snapshot, today) };
    }),
  );

  return <OperationsBoard operations={withSignals} confirmable={confirmable} today={today} />;
}
