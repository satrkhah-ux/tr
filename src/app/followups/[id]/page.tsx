import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { FollowupWorkspace } from "@/components/traveliun/followups/FollowupWorkspace";
import { getFollowupWorkspace, getWorkDetail } from "@/lib/data/followups";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** One SLA follow-up: its manager, or the employee it was handed to — anyone else goes home (data/sla.ts). */
export default async function FollowupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await guardPath("/followups");
  const [data, detail] = await Promise.all([getFollowupWorkspace(), getWorkDetail(id)]);
  if (!data || !detail) redirect("/followups");
  return (
    <TraveliunShell title="nav.followups">
      <FollowupWorkspace initial={data} initialId={id} />
    </TraveliunShell>
  );
}
