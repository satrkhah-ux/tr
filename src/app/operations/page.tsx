import { OperationsBoard } from "@/components/traveliun/operations/OperationsBoard";
import { listOperationWork } from "@/lib/data/operations-work";
import { listCaseOwners } from "@/lib/data/operation-case";
import { currentCan } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/**
 * «العمليات» — the board.
 *
 * Signals are computed on the server, against one clock, by the same loader the
 * dashboard panel uses — so the home page and the board can never disagree about
 * which case is urgent.
 */
export default async function OperationsPage() {
  const [{ items, today }, { owners, staff }, canSeeMoney] = await Promise.all([
    listOperationWork(),
    listCaseOwners(),
    currentCan("pricing.internal"),
  ]);
  return <OperationsBoard operations={items} today={today} owners={owners} staff={staff} canSeeMoney={canSeeMoney} />;
}
