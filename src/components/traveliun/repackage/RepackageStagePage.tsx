import { redirect } from "next/navigation";
import { getRepackage } from "@/lib/data/repackage";
import { getCurrentRole } from "@/lib/data/metrics";
import { can } from "@/lib/roles/roles";
import type { StageKey } from "@/lib/repackage/repackage-types";
import { RepackageShell } from "./RepackageShell";

/** Server wrapper shared by every /repackage/[draftId]/<stage> route. */
export async function RepackageStagePage({ draftId, stage }: { draftId: string; stage: StageKey }) {
  const role = await getCurrentRole();
  if (!can(role, "repackage.write")) redirect("/dashboard");
  const record = await getRepackage(draftId);
  if (!record) redirect("/repackage");
  return <RepackageShell draftId={draftId} stage={stage} initialData={record.data} />;
}
