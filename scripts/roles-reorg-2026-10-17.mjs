// The owner's reorganization (2026-10-17): sales work the operations of their own
// files (operations.own), the administration can view-as sales with the same key,
// and a «مطوّر» role carries everything plus developer.access — which the
// administration's role deliberately does NOT get.
//
//   node scripts/roles-reorg-2026-10-17.mjs            dry run (default)
//   node scripts/roles-reorg-2026-10-17.mjs --commit   backup + apply, one transaction
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

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

const EVERYTHING = [
  "dashboard.admin", "dashboard.employee", "offers.write", "data.write", "employees.manage", "settings.manage",
  "kanban.view", "guide.view", "pricing.view", "pricing.internal", "repackage.write", "operations.write",
  "operations.book", "operations.passport", "operations.own", "developer.access",
];
const ADD = { sales: ["operations.own"], "All Permissions": ["operations.own"] };

const roles = await q(`select * from public.roles order by sort`);
const plan = [];
for (const [english, keys] of Object.entries(ADD)) {
  const role = roles.find((r) => r.english_name === english);
  if (!role) throw new Error(`role ${english} not found`);
  if (role.permission_keys.includes("developer.access")) throw new Error(`${english} carries developer.access — review first`);
  const next = [...new Set([...role.permission_keys, ...keys])];
  if (next.length !== role.permission_keys.length) plan.push({ id: role.id, english, add: keys.filter((k) => !role.permission_keys.includes(k)), next });
}
const developer = roles.find((r) => r.english_name === "Developer");
console.log("updates:", plan.map((p) => `${p.english} +${p.add.join(",")}`).join("; ") || "none");
console.log(developer ? `role «مطوّر» exists (${developer.id})` : "will create role «مطوّر» with every permission");

if (!commit) {
  console.log("dry run — nothing written. Re-run with --commit.");
  await c.end();
  process.exit(0);
}

const dir = "data-import/backups/roles-2026-10-17";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/roles.json`, JSON.stringify({ taken_at: new Date().toISOString(), rows: roles }, null, 1));
await c.query("begin");
try {
  for (const p of plan) await c.query(`update public.roles set permission_keys = $2 where id = $1`, [p.id, p.next]);
  if (!developer) {
    await c.query(
      `insert into public.roles (arabic_name, english_name, permission_keys, description, sort) values ('مطوّر', 'Developer', $1, $2, 5)`,
      [EVERYTHING, "حساب المطوّر: كل الصلاحيات، وصفحة المطوّر لحالة الارتباطات وإيقاف الخدمات وتشغيلها."],
    );
  }
  await c.query(
    `insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, meta) values (null, 'owner-order', 'role.updated', 'roles', null, $1)`,
    [JSON.stringify({ reorg: "2026-10-17", updated: plan.map((p) => ({ role: p.english, add: p.add })), developer_role: developer ? "existed" : "created", backup: dir })],
  );
  await c.query("commit");
  console.log(`done. Backup: ${dir}`);
} catch (e) {
  await c.query("rollback");
  console.error("rolled back:", e.message);
  process.exitCode = 1;
}
await c.end();
