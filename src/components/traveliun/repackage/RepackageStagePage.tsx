import { redirect } from "next/navigation";
import { getRepackage } from "@/lib/data/repackage";
import type { StageKey } from "@/lib/repackage/repackage-types";
import { RepackageShell } from "./RepackageShell";
import { currentCan } from "@/lib/roles/current";

/** Server wrapper shared by every /repackage/[draftId]/<stage> route. */
export async function RepackageStagePage({ draftId, stage }: { draftId: string; stage: StageKey }) {
  if (!await currentCan("repackage.write")) redirect("/dashboard");
  const record = await getRepackage(draftId);
  if (!record) redirect("/repackage");
  return <RepackageShell draftId={draftId} stage={stage} initialData={record.data} />;
}
