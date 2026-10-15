import { redirect } from "next/navigation";
import { DataQualityBoard } from "@/components/traveliun/DataQualityBoard";
import { getDataQualityReport } from "@/lib/data/quality-actions";
import { currentCan, guardPath } from "@/lib/roles/current";

/** Data section order 3: what the reference data lacks, most-used first, each card a fix link. */
export default async function DataQualityPage() {
  await guardPath("/data-quality");
  if (!(await currentCan("data.write"))) redirect("/dashboard");
  return <DataQualityBoard report={await getDataQualityReport()} />;
}
