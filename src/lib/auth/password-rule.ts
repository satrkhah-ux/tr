/**
 * A temporary password an administrator types for someone else — a partner
 * company, an employee, Almatar's login. It is handed over once and must be
 * changed at the first sign-in (app_metadata.must_change_password), so the bar
 * is only that it is not trivially guessed in between.
 *
 * Pure: no Supabase.
 */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < 10) return "كلمة المرور 10 أحرف على الأقل.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "كلمة المرور تجمع حروفاً وأرقاماً.";
  const name = username.trim().toLowerCase();
  if (name && password.toLowerCase().includes(name)) return "كلمة المرور لا تحتوي اسم المستخدم.";
  return null;
}

/** The part of a login address a password must not contain («ahmed» of ahmed@x.com). */
export const loginName = (email: string) => email.trim().toLowerCase().split("@")[0] ?? "";
