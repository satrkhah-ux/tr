import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { DecisionsBoard } from "@/components/traveliun/decisions/DecisionsBoard";
import { getDecisionsArchive } from "@/lib/data/admin-decisions";
import type { ArchiveFilter } from "@/lib/decisions/core";

export const dynamic = "force-dynamic";

/** «القرارات الإدارية» — the administration's (getDecisionsArchive checks employees.manage itself). */
export default async function DecisionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    employee?: string;
    kind?: string;
    from?: string;
    to?: string;
    ack?: string;
  }>;
}) {
  const q = await searchParams;
  const date = (s?: string) =>
    s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
  const filter: ArchiveFilter = {
    employeeId:
      q.employee && /^[0-9a-f-]{36}$/i.test(q.employee)
        ? q.employee
        : undefined,
    kind: q.kind?.slice(0, 40) || undefined,
    from: date(q.from),
    to: date(q.to),
    ack: q.ack === "yes" || q.ack === "no" ? q.ack : "",
  };
  const data = await getDecisionsArchive(filter);
  if (!data) redirect("/employees");
  return (
    <TraveliunShell title="nav.decisions">
      <DecisionsBoard data={data} filter={filter} />
    </TraveliunShell>
  );
}
