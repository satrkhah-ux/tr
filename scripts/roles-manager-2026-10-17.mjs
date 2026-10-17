// The owner's order (2026-10-17): «الصلاحيات لازالت لكل موظف و الادارة وغيرهم نفس
// الشيء» — every employee but the admin sits on «مبيعات». A «مدير مبيعات» role
// between them: everything sales has, plus every file's operations, the admin
// dashboard and cost / profit; no settings, no team management, no deleting
// data, no passports. The owner assigns it from «الموظفون» himself.
//
//   node scripts/roles-manager-2026-10-17.mjs            dry run (default)
//   node scripts/roles-manager-2026-10-17.mjs --commit   backup + create
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const commit = process.argv.includes("--commit");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const KEYS = [
  "dashboard.admin", "dashboard.employee", "offers.write", "data.write", "kanban.view", "guide.view",
  "pricing.view", "pricing.internal", "repackage.write", "operations.write", "operations.own",
];
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const roles = (await c.query(`select * from public.roles order by sort`)).rows;
const existing = roles.find((r) => r.english_name === "Sales Manager");
console.log(existing ? `«مدير مبيعات» exists (${existing.id}) — nothing to do` : `will create «مدير مبيعات» with ${KEYS.length} keys`);
if (!commit || existing) {
  if (!commit) console.log("dry run — nothing written. Re-run with --commit.");
  await c.end();
  process.exit(0);
}
const dir = "data-import/backups/roles-manager-2026-10-17";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/roles.json`, JSON.stringify({ taken_at: new Date().toISOString(), rows: roles }, null, 1));
await c.query("begin");
try {
  const [row] = (
    await c.query(
      `insert into public.roles (arabic_name, english_name, permission_keys, description, sort) values ('مدير مبيعات', 'Sales Manager', $1, $2, 15) returning id`,
      [KEYS, "كل ما يراه موظف المبيعات، ومعه عمليات كل الملفات ولوحة الإدارة والتكلفة والربح. بلا إعدادات ولا إدارة موظفين ولا حذف بيانات ولا جوازات."],
    )
  ).rows;
  await c.query(
    `insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, meta) values (null, 'owner-order', 'role.created', 'roles', $1, $2)`,
    [row.id, JSON.stringify({ role: "مدير مبيعات", keys: KEYS, backup: dir })],
  );
  await c.query("commit");
  console.log(`created ${row.id}. Backup: ${dir}`);
} catch (e) {
  await c.query("rollback");
  console.error("rolled back:", e.message);
  process.exitCode = 1;
}
await c.end();
