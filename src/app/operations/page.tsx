import { OperationsBoard } from "@/components/traveliun/operations/OperationsBoard";
import { listOperationWork } from "@/lib/data/operations-work";

export const dynamic = "force-dynamic";

/**
 * «العمليات» — the board.
 *
 * Signals are computed on the server, against one clock, by the same loader the
 * dashboard panel uses — so the home page and the board can never disagree about
 * which case is urgent.
 */
export default async function OperationsPage() {
  const { items, today } = await listOperationWork();
  return <OperationsBoard operations={items} today={today} />;
}
