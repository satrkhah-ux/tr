import "server-only";
import { cache } from "react";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { isPermission, type Permission, type Role } from "./roles";

/**
 * What the signed-in user may do — resolved from the ROLE their employee row
 * carries, not from a table of role names compiled into the app.
 *
 * Before this, `roles.permission_keys` did not exist and the four fixed roles in
 * roles.ts were the whole model: an administrator could tick boxes on the roles
 * screen and nothing changed. Now the row is the grant, so «الاوبريشن» means
 * exactly the keys someone put on it.
 *
 * Reads go through the ordinary user client: `employees` and `roles` are
 * SELECT-able by any signed-in user (they are listed all over the app) but no
 * longer WRITABLE by them — migration 0030 removed those policies, so nobody can
 * hand themselves a permission through PostgREST. Writes live in data/team.ts.
 */

/** Cached per request: several gates may ask in one action. */
const load = cache(async (): Promise<Permission[]> => {
  const user = await getServerUser();
  if (!user) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data: emp } = await supabase
      .from("employees")
      .select("id, status, roles(permission_keys)")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    const employee = emp as unknown as
      | { id: string; status: string | null; roles: { permission_keys: string[] } | { permission_keys: string[] }[] | null }
      | null;

    // No employee row → nothing. This used to fall through to "employee", which
    // meant any authenticated account inherited a working set of permissions
    // without anyone granting them.
    if (!employee) return [];
    // A suspended colleague keeps their row and loses their access.
    if (employee.status && employee.status !== "Active") return [];

    const role = Array.isArray(employee.roles) ? employee.roles[0] : employee.roles;
    const keys = role?.permission_keys ?? [];
    return keys.filter(isPermission);
  } catch {
    return [];
  }
});

export async function currentPermissions(): Promise<Permission[]> {
  return load();
}

export async function currentCan(permission: Permission): Promise<boolean> {
  return (await load()).includes(permission);
}

/**
 * The coarse label, for the UI and the dev "view as" switch only.
 *
 * It is DERIVED from the permission set rather than stored: a role is an
 * administrator because it can open the admin dashboard, not because of its name
 * — which is what the old `english_name === 'All Permissions'` check compared,
 * and what anyone could rename.
 */
export async function currentRole(): Promise<Role> {
  const permissions = await load();
  if (permissions.includes("dashboard.admin")) return "admin";
  if (permissions.includes("dashboard.employee")) return "employee";
  return "visitor";
}
