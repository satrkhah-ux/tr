import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { FollowupWorkspace } from "@/components/traveliun/followups/FollowupWorkspace";
import { getFollowupWorkspace } from "@/lib/data/followups";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";
export default async function FollowupsPage() {
  await guardPath("/followups");
  const data = await getFollowupWorkspace();
  if (!data) redirect("/dashboard");
  return <TraveliunShell title="nav.followups"><FollowupWorkspace initial={data} /></TraveliunShell>;
}
