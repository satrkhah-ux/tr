import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { SwitchboardBoard } from "@/components/traveliun/presence/SwitchboardBoard";
import { getSwitchboard } from "@/lib/data/switchboard";

export const dynamic = "force-dynamic";

/** «البدّالة» — the administration's (getSwitchboard checks employees.manage / dashboard.admin / developer.access itself). */
export default async function SwitchboardPage() {
  const data = await getSwitchboard();
  if (!data) redirect("/employees");
  return (
    <TraveliunShell title="nav.switchboard">
      <SwitchboardBoard data={data} />
    </TraveliunShell>
  );
}
