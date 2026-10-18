import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TempPasswordResult = "ok" | "in_use" | "wrong_kind" | "failed";

/**
 * Give a login that has NEVER been used a temporary password an administrator
 * typed (the owner, 2026-10-19: «اجعل إمكانية عمل كلمة مرور من داخل النظام» —
 * the set-your-password email did not reach a company). The address is marked
 * confirmed (an invitation nobody opened left it unconfirmed, and an
 * unconfirmed account cannot sign in), and the first page load forces a new
 * password of the person's own (the root layout's ChangePasswordDialog).
 *
 * Refused («in_use») once the account has signed in: then the password is the
 * person's, and replacing it from a screen would hand their working account to
 * whoever typed it — a forgotten password is the recovery link's job.
 * Refused («wrong_kind») when the login is the other kind's: a partner screen
 * never sets a staff password (nor the developer's), a staff screen never a
 * partner's.
 *
 * The password is never stored, returned or logged — callers audit the fact,
 * not the value. `admin` is a service-role client; callers gate first.
 */
export async function setTemporaryPassword(
  admin: SupabaseClient,
  userId: string,
  password: string,
  kind: "partner" | "staff",
): Promise<TempPasswordResult> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return "failed";
  if (data.user.last_sign_in_at) return "in_use";

  // an employee's login (the developer's included) is never a partner screen's; a partner's never a staff screen's
  const [staff, partner] = await Promise.all([
    admin.from("employees").select("id").eq("auth_user_id", userId).limit(1),
    admin.from("partner_users").select("id").eq("auth_user_id", userId).limit(1),
  ]);
  if (staff.error || partner.error) return "failed";
  if (kind === "partner" && (staff.data ?? []).length > 0) return "wrong_kind";
  if (kind === "staff" && (partner.data ?? []).length > 0) return "wrong_kind";

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
    app_metadata: { ...data.user.app_metadata, must_change_password: true },
  });
  return updateError ? "failed" : "ok";
}

/**
 * Take back a login just made with a temporary password that could not be
 * linked to its company or employee: deleted, else banned — a confirmed login
 * whose password someone typed, belonging to nobody, must not stay usable.
 */
export async function discardLogin(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
}

/** What each refusal tells the administrator. */
export const TEMP_PASSWORD_REFUSAL: Record<Exclude<TempPasswordResult, "ok">, string> = {
  in_use: "هذا الحساب دخل النظام من قبل — كلمة مروره لصاحبه، فلا تُستبدل من هنا. أرسل له رابط إعادة التعيين بدلاً من ذلك.",
  wrong_kind: "هذا الحساب ليس من هذا النوع — لا تُعيَّن كلمة مروره من هذه الشاشة.",
  failed: "تعذّر تعيين كلمة المرور.",
};
