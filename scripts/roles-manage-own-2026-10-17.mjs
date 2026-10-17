// The owner's order (2026-10-17): «اريد كل شخص يدير مبيعاته الى ان نوظف مدير مبيعات»
// — operations.manage_own on «مبيعات» (and on «كل الصلاحيات», so viewing the system
// as sales shows what sales get). Revoke when a sales manager is hired: remove the
// key from «مبيعات» on the roles screen.
//
//   node scripts/roles-manage-own-2026-10-17.mjs            dry run (default)
//   node scripts/roles-manage-own-2026-10-17.mjs --commit   backup + apply
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const KEY = "operations.manage_own";
const ROLES = ["sales", "All Permissions"];
const commit = process.argv.includes("--commit");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const roles = (await c.query(`select * from public.roles order by sort`)).rows;
const todo = roles.filter((r) => ROLES.includes(r.english_name) && !r.permission_keys.includes(KEY));
console.log(`will add ${KEY} to: ${todo.map((r) => r.arabic_name).join("، ") || "nobody (already there)"}`);
if (!commit || todo.length === 0) {
  if (!commit) console.log("dry run — nothing written. Re-run with --commit.");
  await c.end();
  process.exit(0);
}
const dir = "data-import/backups/roles-manage-own-2026-10-17";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/roles.json`, JSON.stringify({ taken_at: new Date().toISOString(), rows: roles }, null, 1));
await c.query("begin");
try {
  for (const r of todo) await c.query(`update public.roles set permission_keys = $2 where id = $1`, [r.id, [...r.permission_keys, KEY]]);
  await c.query(
    `insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, meta) values (null, 'owner-order', 'role.updated', 'roles', null, $1)`,
    [JSON.stringify({ add: KEY, roles: todo.map((r) => r.english_name), backup: dir })],
  );
  await c.query("commit");
  console.log(`done. Backup: ${dir}`);
} catch (e) {
  await c.query("rollback");
  console.error("rolled back:", e.message);
  process.exitCode = 1;
}
await c.end();
