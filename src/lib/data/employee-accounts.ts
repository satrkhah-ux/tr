"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { logAudit } from "./audit";
import { currentCan } from "@/lib/roles/current";

/**
 * Issue a staff login from inside the system.
 *
 * An `employees` row is a personnel record, not an account: nine of twelve had
 * one and could not sign in. Creating the auth user was a console job someone
 * with Supabase access had to do, and then remember to write the id back onto
 * the employee — because `auth_user_id` is what every permission check reads.
 * Forget that second step and the person signs in to a system that does not
 * know who they are.
 *
 * So both halves happen here, in one press, and the invitation lets them set
 * their own password. We never see it, and nobody types one for them.
 */

export type EmployeeAccount = {
  id: string;
  arabic_name: string;
  email: string | null;
  status: string | null;
  type: string | null;
  /** linked to a real auth user — the only state that lets them sign in. */
  active: boolean;
  last_sign_in_at: string | null;
  invited_at: string | null;
};

export type AccountsResult =
  | { ok: true; rows: EmployeeAccount[] }
  | { ok: false; error: "err.session" | "err.forbidden" | "err.db" };

/**
 * Only a role that may administer people may see or change their accounts.
 *
 * Read from the role ROW's permission keys (current.ts), like every other gate
 * on the Employees screen — not from the coarse admin/employee label, which
 * would let a section that was never given `employees.manage` issue logins.
 */
async function guard(): Promise<"ok" | "err.session" | "err.forbidden"> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return (await currentCan("employees.manage")) ? "ok" : "err.forbidden";
}

export async function listEmployeeAccounts(): Promise<AccountsResult> {
  const gate = await guard();
  if (gate !== "ok") return { ok: false, error: gate };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("employees")
      .select("id, arabic_name, email, status, type, auth_user_id")
      .order("arabic_name");
    if (error) return { ok: false, error: "err.db" };

    const rows = (data ?? []) as {
      id: string;
      arabic_name: string;
      email: string | null;
      status: string | null;
      type: string | null;
      auth_user_id: string | null;
    }[];

    // The sign-in history lives in auth.users, which only the service role may
    // read — and it is the difference between «invited» and «actually using it».
    const admin = createSupabaseServiceClient();
    const { data: userPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const byId = new Map((userPage?.users ?? []).map((u) => [u.id, u]));

    return {
      ok: true,
      rows: rows.map((r) => {
        const u = r.auth_user_id ? byId.get(r.auth_user_id) : undefined;
        return {
          id: r.id,
          arabic_name: r.arabic_name,
          email: r.email,
          status: r.status,
          type: r.type,
          active: Boolean(u),
          last_sign_in_at: u?.last_sign_in_at ?? null,
          invited_at: u?.created_at ?? null,
        };
      }),
    };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type IssueResult = { ok: true; email: string } | { ok: false; message: string };

export async function issueEmployeeAccount(employeeId: string): Promise<IssueResult> {
  const gate = await guard();
  if (gate === "err.session") return { ok: false, message: "انتهت الجلسة." };
  if (gate === "err.forbidden") return { ok: false, message: "لا تملك صلاحية إدارة الموظفين." };

  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("employees")
      .select("id, arabic_name, email, auth_user_id")
      .eq("id", employeeId)
      .maybeSingle();
    const row = data as { id: string; arabic_name: string; email: string | null; auth_user_id: string | null } | null;
    if (!row) return { ok: false, message: "لم يُعثر على الموظف." };

    const email = row.email?.trim().toLowerCase();
    if (!email) return { ok: false, message: "أضف بريد الموظف أولاً — الدعوة تُرسل إليه." };
    if (row.auth_user_id) return { ok: false, message: "لهذا الموظف حساب بالفعل." };

    const admin = createSupabaseServiceClient();

    // An address may already own an account from an earlier attempt. Inviting
    // again fails; linking the one that exists is what was actually wanted.
    const { data: page } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    let existing = (page?.users ?? []).find((u) => u.email?.toLowerCase() === email);
    let removedLeftover: string | null = null;

    if (existing?.banned_until && Date.parse(existing.banned_until) > Date.now()) {
      // A banned account is a self-registration. Still in the queue: linking it
      // here would approve it with no role decision and no record of who let
      // them in. NOT in the queue (its request insert failed, or a rejection
      // could not delete it): a leftover nothing else can clear, whose password
      // was set by someone who never proved they own the address — removed, so
      // the invite below goes to whoever does.
      const { data: open, error: openError } = await (admin as unknown as SupabaseClient)
        .from("staff_registrations")
        .select("id")
        .eq("auth_user_id", existing.id)
        .eq("status", "pending")
        .limit(1);
      if (openError) return { ok: false, message: "تعذّر إصدار الحساب." };
      if ((open ?? []).length > 0 || existing.user_metadata?.["self_registered"] !== true) {
        return { ok: false, message: "لهذا البريد طلب تسجيل قيد المراجعة — قرّر فيه من قائمة الطلبات أعلى صفحة الموظفين." };
      }
      if ((await admin.auth.admin.deleteUser(existing.id)).error) return { ok: false, message: "تعذّر إصدار الحساب." };
      removedLeftover = existing.id;
      existing = undefined;
    }

    if (existing) {
      // A partner login must never also be staff: it would pass is_staff() and
      // the partner policies at the same time.
      const { data: partner } = await admin
        .from("partner_users")
        .select("id")
        .eq("auth_user_id", existing.id)
        .limit(1);
      if ((partner ?? []).length > 0) {
        return { ok: false, message: "هذا البريد حساب شركة متعاونة — لا يُربط بموظف." };
      }
    }

    let authUserId = existing?.id ?? null;
    if (!authUserId) {
      // WITHOUT redirectTo the invitation lands on the site root, which does
      // nothing at all: the account exists and there is no way to set a
      // password for it.
      const site = (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");
      const { data: invite, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { employee_id: row.id, employee_name: row.arabic_name },
        redirectTo: `${site}/sign-in`,
      });
      if (error || !invite?.user) {
        return { ok: false, message: "تعذّر إرسال الدعوة — تأكد من إعدادات البريد لدى Supabase." };
      }
      authUserId = invite.user.id;
    }

    // The link is the load-bearing half: every permission check reads
    // auth_user_id, so an account without it signs in to a system that does
    // not know who they are.
    const { error: linkError } = await admin
      .from("employees")
      .update({ auth_user_id: authUserId } as never)
      .eq("id", row.id);
    if (linkError) {
      return { ok: false, message: "أُنشئ الحساب ولم يُربط بالموظف — راجع السجل." };
    }

    await logAudit({
      action: existing ? "employee.account_linked" : "employee.account_issued",
      entity: "employees",
      entity_id: row.id,
      meta: removedLeftover ? { email, removed_leftover_account: removedLeftover } : { email },
    });

    return { ok: true, email };
  } catch {
    return { ok: false, message: "تعذّر إصدار الحساب." };
  }
}
