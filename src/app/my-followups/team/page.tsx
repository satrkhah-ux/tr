import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { MyFollowupsTeam } from "@/components/traveliun/mine/MyFollowupsTeam";
import { getMyFollowupsTeam } from "@/lib/data/my-followups";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";
export default async function MyFollowupsTeamPage() {
  await guardPath("/my-followups/team");
  const team = await getMyFollowupsTeam();
  if (!team) redirect("/my-followups");
  return (
    <TraveliunShell title="nav.myFollowups">
      <MyFollowupsTeam rows={team.rows} at={team.at} />
    </TraveliunShell>
  );
}
