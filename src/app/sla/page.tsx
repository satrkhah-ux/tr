import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { SlaBoard } from "@/components/traveliun/sla/SlaBoard";
import { guardPath } from "@/lib/roles/current";
import { getSlaBoard } from "@/lib/data/sla";

export const dynamic = "force-dynamic";

/** «SLA» — the administration and the developer only (section-access.ts, and data/sla.ts again). */
export default async function SlaPage() {
  await guardPath("/sla");
  const board = await getSlaBoard();
  if (!board.ok) redirect("/dashboard");
  return (
    <TraveliunShell title="nav.sla">
      <SlaBoard initial={board} />
    </TraveliunShell>
  );
}
