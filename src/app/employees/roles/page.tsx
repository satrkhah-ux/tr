import { redirect } from "next/navigation";
import { TeamRoles } from "@/components/traveliun/TeamRoles";
import { listTeamMembers, listTeamRoles } from "@/lib/data/team";
import { currentCan } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/**
 * «الأقسام والصلاحيات» — a real route, so it wins over the generic table page the
 * catch-all used to serve here.
 *
 * Gated: this screen decides what everyone else can do, so only a holder of
 * `employees.manage` may open it. The actions behind it check the same permission
 * again — a redirect is a courtesy, not a control.
 */
export default async function RolesPage() {
  if (!(await currentCan("employees.manage"))) redirect("/dashboard");

  const [roles, members] = await Promise.all([listTeamRoles(), listTeamMembers()]);
  return <TeamRoles roles={roles} members={members} />;
}
