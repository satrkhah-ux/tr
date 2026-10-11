import { TeamMembers } from "@/components/traveliun/TeamMembers";
import { listPendingRegistrations, listTeamMembers, listTeamRoles } from "@/lib/data/team";
import { currentCan } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/**
 * «الموظفين» — bespoke, because the section a colleague sits in decides what they
 * can do and must not be an ordinary editable cell. Reading the list is open to
 * the team (colleagues are listed all over the app); every control that writes is
 * behind `employees.manage`, and so is every action it calls.
 */
export default async function EmployeesPage() {
  // listPendingRegistrations checks employees.manage itself and answers [] to
  // anyone else, so it can run alongside the gate instead of after it.
  const [members, roles, canManage, registrations] = await Promise.all([
    listTeamMembers(),
    listTeamRoles(),
    currentCan("employees.manage"),
    listPendingRegistrations(),
  ]);
  return <TeamMembers members={members} roles={roles} registrations={registrations} canManage={canManage} />;
}
