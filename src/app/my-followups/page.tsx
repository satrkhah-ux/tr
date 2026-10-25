import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { MyFollowups } from "@/components/traveliun/mine/MyFollowups";
import { getMyFollowups } from "@/lib/data/my-followups";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";
export default async function MyFollowupsPage({ searchParams }: { searchParams: Promise<{ employee?: string }> }) {
  await guardPath("/my-followups");
  const { employee } = await searchParams;
  const view = await getMyFollowups(employee);
  if (!view) redirect("/dashboard");
  return (
    <TraveliunShell title="nav.myFollowups">
      <MyFollowups view={view} />
    </TraveliunShell>
  );
}
