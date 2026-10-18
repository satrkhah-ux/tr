import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Give an existing login a temporary password an administrator typed (the
 * owner, 2026-10-19: «اجعل إمكانية عمل كلمة مرور من داخل النظام» — the
 * set-your-password email did not reach a company). The address is marked
 * confirmed (an invitation nobody opened left it unconfirmed, and an
 * unconfirmed account cannot sign in), and the first page load forces a new
 * password of the person's own (the root layout's ChangePasswordDialog).
 *
 * The password is never stored, returned or logged — callers audit the fact,
 * not the value. `admin` is a service-role client; callers gate first.
 */
export async function setTemporaryPassword(admin: SupabaseClient, userId: string, password: string): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return false;
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
    app_metadata: { ...data.user.app_metadata, must_change_password: true },
  });
  return !updateError;
}
