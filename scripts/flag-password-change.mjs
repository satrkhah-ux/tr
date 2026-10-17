// Make an account change its password at its next page load (2026-10-17): sets
// the auth user's app_metadata.must_change_password = true. src/app/layout.tsx
// reads it and holds the app behind the forced «تغيير كلمة المرور» dialog;
// clearMustChangePassword (src/lib/data/account-actions.ts) clears it after the
// change. app_metadata is writable only with the service role, never by the user.
//
//   node scripts/flag-password-change.mjs <email>            dry run (default)
//   node scripts/flag-password-change.mjs <email> --commit   set the flag
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const commit = process.argv.includes("--commit");
const email = process.argv
  .slice(2)
  .find((a) => !a.startsWith("--"))
  ?.trim()
  .toLowerCase();
if (!email) {
  console.error("usage: node scripts/flag-password-change.mjs <email> [--commit]");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

let user = null;
for (let page = 1; !user; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  user = data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 1000) break;
}
// exitCode, not process.exit(): exiting with fetch sockets still open trips a
// libuv assertion on Windows.
if (!user) {
  console.error(`no auth user with the email ${email}`);
  process.exitCode = 1;
} else {
  console.log(`auth user ${user.id} <${user.email}> — must_change_password now: ${user.app_metadata?.must_change_password === true}`);
  if (!commit) {
    console.log("dry run — nothing written. Re-run with --commit.");
  } else {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, must_change_password: true },
    });
    if (error) {
      console.error("failed:", error.message);
      process.exitCode = 1;
    } else {
      console.log("flagged — the account is asked for a new password on its next page load.");
    }
  }
}
