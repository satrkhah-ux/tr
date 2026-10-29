import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { AttendanceBoard } from "@/components/traveliun/presence/AttendanceBoard";
import { getAttendance } from "@/lib/data/presence-status";

export const dynamic = "force-dynamic";

/** «الحضور والإجازات» — the administration's (getAttendance checks employees.manage / dashboard.admin itself). */
export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day } = await searchParams;
  const data = await getAttendance(day);
  if (!data) redirect("/employees");
  return (
    <TraveliunShell title="nav.attendance">
      <AttendanceBoard data={data} />
    </TraveliunShell>
  );
}
