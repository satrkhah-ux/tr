import { OpsDayBoard } from "@/components/traveliun/operations/OpsDayBoard";
import { getOpsDay } from "@/lib/data/ops-day";

export const dynamic = "force-dynamic";

/** «مهام اليوم» — what every live case still misses, in one list (the owner, 2026-10-26). */
export default async function OpsDayPage() {
  // /operations' own section gate covers this path; each case inside is loaded through the caller's scope
  return <OpsDayBoard day={await getOpsDay()} />;
}
