// The owner's order (2026-10-17): al3r18y@aol.com becomes the developer account.
// It was the owner login of a partner company («شركة الأفق للسفر والسياحة»); the
// owner chose to unlink it from the partner and link it to an employee row with
// the «مطوّر» role, and to force a password change at its next sign-in.
//
//   node scripts/developer-account-2026-10-17.mjs            dry run (default)
//   node scripts/developer-account-2026-10-17.mjs --commit   backup + apply
//
// Never sets a password. The partner company itself is kept; it only loses
// this login. The JWT's user_metadata.partner_id (route-guard.ts redirects on
// it) is cleared, and app_metadata.must_change_password is set.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const EMAIL = "al3r18y@aol.com";
const commit = process.argv.includes("--commit");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;

const [user] = await q(`select id, email, raw_user_meta_data, raw_app_meta_data from auth.users where lower(email) = $1`, [EMAIL]);
if (!user) throw new Error(`${EMAIL} has no auth account`);
const partnerLinks = await q(`select * from public.partner_users where auth_user_id = $1`, [user.id]);
const employees = await q(`select * from public.employees where auth_user_id = $1 or lower(email) = $2`, [user.id, EMAIL]);
const [role] = await q(`select id from public.roles where english_name = 'Developer'`);
if (!role) throw new Error("role «مطوّر» missing — run roles-reorg-2026-10-17.mjs first");
if (employees.length) throw new Error(`already an employee: ${JSON.stringify(employees.map((e) => e.id))} — review first`);
const others = partnerLinks.length
  ? await q(`select count(*)::int as n from public.partner_users where partner_id = $1 and auth_user_id <> $2`, [partnerLinks[0].partner_id, user.id])
  : [{ n: 0 }];
console.log(`auth user ${user.id}; partner links to remove: ${partnerLinks.length} (the partner keeps ${others[0].n} other login(s)); will link employee «المطوّر» with role ${role.id}`);

if (!commit) {
  console.log("dry run — nothing written. Re-run with --commit.");
  await c.end();
  process.exit(0);
}

const dir = "data-import/backups/developer-account-2026-10-17";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/before.json`, JSON.stringify({ taken_at: new Date().toISOString(), user, partner_users: partnerLinks }, null, 1));

await c.query("begin");
try {
  await c.query(`delete from public.partner_users where auth_user_id = $1`, [user.id]);
  const [emp] = (
    await c.query(
      `insert into public.employees (arabic_name, english_name, email, role_id, status, auth_user_id) values ('المطوّر', 'Developer', $1, $2, 'Active', $3) returning id`,
      [EMAIL, role.id, user.id],
    )
  ).rows;
  await c.query(
    `insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, meta) values (null, 'owner-order', 'employee.account_linked', 'employees', $1, $2)`,
    [emp.id, JSON.stringify({ email: EMAIL, role: "Developer", unlinked_partner: partnerLinks.map((p) => p.partner_id), backup: dir })],
  );
  await c.query("commit");
  console.log(`employee ${emp.id} linked; partner link removed. Backup: ${dir}`);
} catch (e) {
  await c.query("rollback");
  console.error("rolled back:", e.message);
  await c.end();
  process.exit(1);
}
await c.end();

// auth metadata through the admin API (merged by GoTrue, other keys kept)
const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
  method: "PUT",
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    user_metadata: { partner_id: null, partner_name: null },
    app_metadata: { must_change_password: true },
  }),
});
const body = await res.json();
console.log(
  res.ok
    ? `metadata: partner_id=${body.user_metadata?.partner_id ?? null}, must_change_password=${body.app_metadata?.must_change_password}`
    : `metadata update FAILED ${res.status}`,
);
