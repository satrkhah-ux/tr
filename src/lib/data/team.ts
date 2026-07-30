"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { currentCan } from "@/lib/roles/current";
import { isPermission, type Permission } from "@/lib/roles/roles";

/**
 * Sections, their permissions, and who is in them.
 *
 * THE ONLY WRITER of `roles` and `employees`. Migration 0030 removed the
 * write policies from both tables, so PostgREST refuses an UPDATE from a signed-in
 * user — which is what stops a colleague from setting their own role_id to the
 * administrator row and granting themselves everything. The service client here is
 * that gate's other half: it can write, and it only runs after `employees.manage`
 * has been checked and an audit row written.
 *
 * Reads use the ORDINARY client on purpose: both tables are SELECT-able by any
 * signed-in user, and reading them through the service role would quietly bypass
 * the one policy that is still there to be trusted.
 */

type Fail = { ok: false; error: TranslationKey };

function service(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

async function requireManage(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return (await currentCan("employees.manage")) ? null : "err.forbidden";
}

export type TeamRole = {
  id: string;
  arabic_name: string;
  english_name: string | null;
  description: string | null;
  sort: number;
  permission_keys: Permission[];
  /** how many colleagues sit in this section — a role with people cannot vanish. */
  members: number;
};

export type TeamMember = {
  id: string;
  arabic_name: string;
  english_name: string | null;
  email: string | null;
  mobile: string | null;
  status: string;
  role_id: string | null;
  role_name: string | null;
  /** false = no sign-in account is linked yet, so the permissions do nothing yet. */
  has_login: boolean;
};

export async function listTeamRoles(): Promise<TeamRole[]> {
  try {
    const user = await getServerUser();
    if (!user) return [];
    const supabase = await createSupabaseServerClient();
    const [rolesRes, empRes] = await Promise.all([
      supabase.from("roles").select("id, arabic_name, english_name, description, sort, permission_keys").order("sort"),
      supabase.from("employees").select("role_id"),
    ]);

    const counts = new Map<string, number>();
    for (const row of (empRes.data ?? []) as { role_id: string | null }[]) {
      if (row.role_id) counts.set(row.role_id, (counts.get(row.role_id) ?? 0) + 1);
    }

    type Row = Omit<TeamRole, "permission_keys" | "members"> & { permission_keys: string[] | null };
    return ((rolesRes.data ?? []) as Row[]).map((r) => ({
      ...r,
      // An unknown key in the column is dropped rather than shown: it grants
      // nothing at runtime either (see current.ts), and the screen must not imply
      // a permission the app does not have.
      permission_keys: (r.permission_keys ?? []).filter(isPermission),
      members: counts.get(r.id) ?? 0,
    }));
  } catch {
    return [];
  }
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  try {
    const user = await getServerUser();
    if (!user) return [];
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("employees")
      .select("id, arabic_name, english_name, email, mobile, status, role_id, auth_user_id, roles(arabic_name)")
      .order("arabic_name");

    type Row = Omit<TeamMember, "role_name" | "has_login"> & {
      auth_user_id: string | null;
      roles: { arabic_name: string } | { arabic_name: string }[] | null;
    };
    return ((data ?? []) as unknown as Row[]).map((e) => {
      const role = Array.isArray(e.roles) ? e.roles[0] : e.roles;
      return {
        id: e.id,
        arabic_name: e.arabic_name,
        english_name: e.english_name,
        email: e.email,
        mobile: e.mobile,
        status: e.status,
        role_id: e.role_id,
        role_name: role?.arabic_name ?? null,
        has_login: Boolean(e.auth_user_id),
      };
    });
  } catch {
    return [];
  }
}

export async function saveRole(input: {
  id?: string;
  arabic_name: string;
  english_name?: string | null;
  description?: string | null;
  sort?: number;
  permission_keys: string[];
}): Promise<{ ok: true; id: string } | Fail> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  if (!input.arabic_name.trim()) return { ok: false, error: "team.err.nameRequired" };

  // Only keys the app actually understands reach the column. A typo stored here
  // would read as a permission on the screen and grant nothing in the code.
  const keys = [...new Set(input.permission_keys.filter(isPermission))];

  try {
    const supabase = service();
    const patch = {
      arabic_name: input.arabic_name.trim(),
      english_name: input.english_name?.trim() || null,
      description: input.description?.trim() || null,
      ...(input.sort != null ? { sort: input.sort } : {}),
      permission_keys: keys,
    };

    const query = input.id
      ? supabase.from("roles").update(patch).eq("id", input.id).select("id").single()
      : supabase.from("roles").insert(patch).select("id").single();

    const { data, error } = await query;
    if (error || !data) return { ok: false, error: input.id ? "err.updateFailed" : "err.createFailed" };

    const id = (data as { id: string }).id;
    // The full key list goes in the audit row: "who widened what, and when" is
    // the question this table exists to answer.
    await logAudit({
      action: input.id ? "role.updated" : "role.created",
      entity: "roles",
      entity_id: id,
      meta: { name: patch.arabic_name, permissions: keys },
    });
    return { ok: true, id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function deleteRole(id: string): Promise<{ ok: true } | Fail> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = service();
    // Deleting a section with people in it would null their role_id and silently
    // strip their access. Move them first — the screen says so.
    const used = await supabase.from("employees").select("id", { count: "exact", head: true }).eq("role_id", id);
    if ((used.count ?? 0) > 0) return { ok: false, error: "team.err.roleInUse" };

    const { error } = await supabase.from("roles").delete().eq("id", id);
    if (error) return { ok: false, error: "err.deleteFailed" };
    await logAudit({ action: "role.deleted", entity: "roles", entity_id: id, meta: {} });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Move a colleague into a section.
 *
 * This single field decides everything they can do, which is why it is not a
 * column the generic table editor may touch (see actions.ts) and why it is
 * audited with both the old and the new section.
 */
export async function setMemberRole(employeeId: string, roleId: string | null): Promise<{ ok: true } | Fail> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = service();
    const before = await supabase.from("employees").select("role_id").eq("id", employeeId).maybeSingle();
    const { error } = await supabase.from("employees").update({ role_id: roleId }).eq("id", employeeId);
    if (error) return { ok: false, error: "err.updateFailed" };

    await logAudit({
      action: "employee.role_changed",
      entity: "employees",
      entity_id: employeeId,
      meta: { from: (before.data as { role_id: string | null } | null)?.role_id ?? null, to: roleId },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function saveMember(input: {
  id?: string;
  arabic_name: string;
  english_name?: string | null;
  email?: string | null;
  mobile?: string | null;
  status?: string;
  role_id?: string | null;
}): Promise<{ ok: true; id: string } | Fail> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  if (!input.arabic_name.trim()) return { ok: false, error: "team.err.nameRequired" };

  try {
    const supabase = service();
    const patch: Record<string, unknown> = { arabic_name: input.arabic_name.trim() };
    if (input.english_name !== undefined) patch.english_name = input.english_name?.trim() || null;
    if (input.email !== undefined) patch.email = input.email?.trim() || null;
    if (input.mobile !== undefined) patch.mobile = input.mobile?.trim() || null;
    if (input.status !== undefined) patch.status = input.status;
    if (input.role_id !== undefined) patch.role_id = input.role_id;

    const query = input.id
      ? supabase.from("employees").update(patch).eq("id", input.id).select("id").single()
      : supabase.from("employees").insert(patch).select("id").single();

    const { data, error } = await query;
    if (error || !data) return { ok: false, error: input.id ? "err.updateFailed" : "err.createFailed" };
    const id = (data as { id: string }).id;
    await logAudit({
      action: input.id ? "employee.updated" : "employee.created",
      entity: "employees",
      entity_id: id,
      meta: { name: patch.arabic_name, role_id: input.role_id ?? null },
    });
    return { ok: true, id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Suspend rather than delete.
 *
 * An employee row is referenced by offers, bookings, audit rows and payments;
 * deleting it turns «الموظف المختص» into an empty field on documents that were
 * already sent. Status «Suspended» removes every permission (current.ts) while
 * the history stays readable.
 */
export async function suspendMember(employeeId: string, suspended: boolean): Promise<{ ok: true } | Fail> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = service();
    const { error } = await supabase
      .from("employees")
      .update({ status: suspended ? "Suspended" : "Active" })
      .eq("id", employeeId);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({
      action: "employee.updated",
      entity: "employees",
      entity_id: employeeId,
      meta: { suspended },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
