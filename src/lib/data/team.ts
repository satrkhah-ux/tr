"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { currentCan } from "@/lib/roles/current";
import { isPermission, type Permission } from "@/lib/roles/roles";
import { PENDING_BAN } from "@/lib/team/register-rules";

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
    // employees_email_uniq (0046): the address already belongs to someone else.
    if (error?.code === "23505") return { ok: false, error: "team.err.emailTaken" };
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
    // employees_email_uniq (0046): the address already belongs to someone else.
    if (error?.code === "23505") return { ok: false, error: "team.err.emailTaken" };
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

/**
 * Self-registrations waiting for a decision (staff_registrations, 0046).
 *
 * Read through the SERVICE client, unlike the reads above: the table has no
 * policy and no grant for signed-in users, on purpose — an applicant's mobile
 * and note are for the people who decide, not for every colleague.
 */
export type PendingRegistration = {
  id: string;
  arabic_name: string;
  english_name: string | null;
  email: string;
  mobile: string;
  note: string | null;
  created_at: string;
};

export async function listPendingRegistrations(): Promise<PendingRegistration[]> {
  if (await requireManage()) return [];
  try {
    const { data } = await service()
      .from("staff_registrations")
      .select("id, arabic_name, english_name, email, mobile, note, created_at")
      .eq("status", "pending")
      .order("created_at");
    return (data ?? []) as PendingRegistration[];
  } catch {
    return [];
  }
}

function approvalError(error: PostgrestError | null): TranslationKey {
  if (error?.code === "23505") return "team.err.emailTaken";
  if (error?.message.includes("bad_role")) return "team.err.roleRequired";
  if (error?.message.includes("not_pending")) return "team.pending.handled";
  return "err.createFailed";
}

/**
 * Let an applicant in, into the section the approver chose.
 *
 * Order matters. The ban is lifted FIRST: for that moment the account has no
 * employees row, which in this app means no permission at all (current.ts,
 * is_staff()). Then one database call claims the request and creates the Active
 * employee together. The other order would leave an Active employee whose login
 * still refuses them, with the request already marked approved — nothing left to
 * press. If the database call fails, the ban goes back on, unless someone else's
 * approval got there first (then the account is theirs to keep).
 *
 * If the database cannot be reached at all, the call and the follow-up read both
 * come back as errors (postgrest-js returns them, it does not throw) and the ban
 * stays off: an account with no employees row and no permission (0045), its
 * request still pending, so pressing approve or reject again finishes it. Not
 * re-banned on an unknown outcome on purpose — if the call did commit, that
 * would lock out a just-approved employee with nothing left to press.
 */
export async function approveRegistration(id: string, roleId: string): Promise<{ ok: true } | Fail> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  if (!roleId) return { ok: false, error: "team.err.roleRequired" };

  try {
    const supabase = service();
    const { data } = await supabase
      .from("staff_registrations")
      .select("status, auth_user_id")
      .eq("id", id)
      .maybeSingle();
    const request = data as { status: string; auth_user_id: string | null } | null;
    if (!request || request.status !== "pending" || !request.auth_user_id) {
      return { ok: false, error: "team.pending.handled" };
    }
    const authUserId = request.auth_user_id;
    // Before the ban is lifted: nothing that can throw may sit between the lift
    // and the call, or the catch below would leave the account open.
    const reviewer = await getCurrentEmployeeId();

    const lifted = await supabase.auth.admin.updateUserById(authUserId, { ban_duration: "none" });
    if (lifted.error) return { ok: false, error: "err.updateFailed" };

    const { data: employeeId, error } = await supabase.rpc("approve_staff_registration", {
      p_id: id,
      p_role: roleId,
      p_reviewer: reviewer,
    });
    if (error || !employeeId) {
      const after = await supabase.from("staff_registrations").select("status").eq("id", id).maybeSingle();
      if ((after.data as { status: string } | null)?.status === "pending") {
        await supabase.auth.admin.updateUserById(authUserId, { ban_duration: PENDING_BAN });
      }
      return { ok: false, error: approvalError(error) };
    }

    await logAudit({
      action: "staff_registration.approved",
      entity: "staff_registrations",
      entity_id: id,
      meta: { employee_id: employeeId as string, role_id: roleId },
    });
    revalidatePath("/employees");
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Turn a request down: the request keeps the reason, the account is deleted.
 *
 * The conditional update is the claim — a request someone already approved
 * cannot be rejected out from under them. The same address cannot quietly
 * re-apply for 30 days (staff-registration.ts).
 */
export async function rejectRegistration(id: string, reason: string): Promise<{ ok: true } | Fail> {
  const denied = await requireManage();
  if (denied) return { ok: false, error: denied };
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) return { ok: false, error: "team.err.reasonRequired" };

  try {
    const supabase = service();
    const { data, error } = await supabase
      .from("staff_registrations")
      .update({
        status: "rejected",
        reject_reason: why,
        reviewed_by: await getCurrentEmployeeId(),
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("auth_user_id")
      .maybeSingle();
    if (error) return { ok: false, error: "err.updateFailed" };
    if (!data) return { ok: false, error: "team.pending.handled" };

    // Still banned if this fails, so it cannot sign in either way; the audit
    // row says which, and «إصدار حساب» for that address clears the leftover
    // (employee-accounts.ts).
    const authUserId = (data as { auth_user_id: string | null }).auth_user_id;
    const removed = authUserId ? !(await supabase.auth.admin.deleteUser(authUserId)).error : true;

    await logAudit({
      action: "staff_registration.rejected",
      entity: "staff_registrations",
      entity_id: id,
      meta: { reason: why, account_deleted: removed },
    });
    revalidatePath("/employees");
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
