import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { grantedPermissions, VIEW_AS_COOKIE, viewAsPermissions, type Permission, type Role } from "./roles";
import { canOpenPath } from "./section-access";
import { getFeatureFlags } from "@/lib/features-server";

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
const loadReal = cache(async (): Promise<Permission[]> => {
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
    // without anyone granting them. A suspended colleague keeps their row and
    // loses their access. Same rule as public.staff_can() (0073).
    const role = Array.isArray(employee?.roles) ? employee.roles[0] : employee?.roles;
    return grantedPermissions(employee ? { status: employee.status, permission_keys: role?.permission_keys ?? null } : null);
  } catch {
    return [];
  }
});

export type ViewAs = { roleId: string; name: string };

/**
 * «التبديل بين الحسابات»: the role an administrator / the developer is looking
 * through (cookie VIEW_AS_COOKIE), with the narrowed permissions — or null.
 * A cookie the account may not use is ignored, never trusted (roles.ts viewAsPermissions).
 */
const loadViewAs = cache(async (): Promise<(ViewAs & { permissions: Permission[] }) | null> => {
  const real = await loadReal();
  try {
    const roleId = (await cookies()).get(VIEW_AS_COOKIE)?.value;
    if (!roleId) return null;
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("roles").select("id, arabic_name, permission_keys").eq("id", roleId).maybeSingle();
    const role = data as { id: string; arabic_name: string | null; permission_keys: string[] | null } | null;
    if (!role) return null;
    const permissions = viewAsPermissions(real, role.permission_keys ?? []);
    return permissions ? { roleId: role.id, name: role.arabic_name ?? "", permissions } : null;
  } catch {
    return null;
  }
});

/** What this request runs with: the viewed-as role's keys while switching, else the account's own. */
const load = cache(async (): Promise<Permission[]> => (await loadViewAs())?.permissions ?? (await loadReal()));

export async function currentPermissions(): Promise<Permission[]> {
  return load();
}

/** The account's OWN permissions, ignoring any view-as — for the switcher and for granting. */
export async function currentRealPermissions(): Promise<Permission[]> {
  return loadReal();
}

export async function currentViewAs(): Promise<ViewAs | null> {
  const v = await loadViewAs();
  return v ? { roleId: v.roleId, name: v.name } : null;
}

export async function currentCan(permission: Permission): Promise<boolean> {
  return (await load()).includes(permission);
}

/**
 * The page-side half of section-access.ts: a section the menu hides must not
 * open from a typed URL either. Called at the top of each gated page or layout.
 */
export async function guardPath(pathname: string): Promise<void> {
  if (!(await currentCanOpen(pathname))) redirect("/dashboard");
}

/** The menus' rule (section-access.ts canOpenPath) with this request's permissions and switches. */
export async function currentCanOpen(pathname: string): Promise<boolean> {
  const [permissions, flags] = await Promise.all([load(), getFeatureFlags()]);
  return canOpenPath(pathname, (p) => permissions.includes(p), (f) => flags[f]);
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
