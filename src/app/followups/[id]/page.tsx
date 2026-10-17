import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { FollowupThread } from "@/components/traveliun/sla/FollowupThread";
import { getFollowupThread } from "@/lib/data/sla";

export const dynamic = "force-dynamic";

/** One SLA follow-up: its manager, or the employee it was handed to — anyone else goes home (data/sla.ts). */
export default async function FollowupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getFollowupThread(id);
  if (!data.ok) redirect("/dashboard");
  return (
    <TraveliunShell title="nav.sla">
      <FollowupThread data={data} />
    </TraveliunShell>
  );
}
