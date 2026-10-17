"use server";

import { cookies } from "next/headers";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentRealPermissions } from "@/lib/roles/current";
import { canSwitchRoles, switchableRoles, VIEW_AS_COOKIE, viewAsPermissions } from "@/lib/roles/roles";

/**
 * The signed-in account's own session settings: which role it looks through
 * («عرض النظام كـ», roles.ts) and the first-login password flag.
 *
 * Every gate reads the REAL permissions (currentRealPermissions): while viewing
 * as sales the account holds sales' keys, and the way back must not depend on them.
 */

type RoleRow = { id: string; arabic_name: string | null; permission_keys: string[] | null };

export async function listSwitchableRoles(): Promise<{ id: string; name: string }[]> {
  const real = await currentRealPermissions();
  if (!canSwitchRoles(real)) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("roles").select("id, arabic_name, permission_keys").order("sort");
    return switchableRoles(real, (data ?? []) as RoleRow[]).map((r) => ({ id: r.id, name: r.arabic_name ?? "" }));
  } catch {
    return [];
  }
}

/** null = back to the account's own role. The cookie is re-checked on every request (current.ts), so this check is the courtesy, that one the control. */
export async function setViewAsRole(roleId: string | null): Promise<{ ok: boolean }> {
  const jar = await cookies();
  // Going back is always allowed — even an account that lost the right to switch.
  if (!roleId) {
    jar.delete(VIEW_AS_COOKIE);
    return { ok: true };
  }
  const real = await currentRealPermissions();
  if (!canSwitchRoles(real)) return { ok: false };
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("roles").select("id, arabic_name, permission_keys").eq("id", roleId).maybeSingle();
    const role = data as RoleRow | null;
    if (!role || !viewAsPermissions(real, role.permission_keys ?? [])) return { ok: false };
    jar.set(VIEW_AS_COOKIE, role.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // a working day: a forgotten switch does not outlive the shift.
      maxAge: 60 * 60 * 12,
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Called by the change-password dialog right after the browser changed the
 * password (supabase.auth.updateUser, which also enforces "not the same as
 * before"). Clears app_metadata.must_change_password — set with the service
 * role by scripts/flag-password-change.mjs, not writable by the user — for the
 * SESSION's user only, and only when it is set.
 */
export async function clearMustChangePassword(): Promise<{ ok: boolean }> {
  const user = await getServerUser();
  if (!user) return { ok: false };
  if (user.app_metadata?.["must_change_password"] !== true) return { ok: true };
  try {
    const { error } = await createSupabaseServiceClient().auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, must_change_password: false },
    });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
