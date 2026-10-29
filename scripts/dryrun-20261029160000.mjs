// Dry run of 20261029160000 («إضافات الموظفين» + payment/bank term kinds) in one
// rolled-back transaction: applied twice, a pending addition saved, a bad kind
// and an empty name refused, a salesperson's session reads nothing.
// The new enum values cannot be USED inside the transaction that adds them
// (Postgres), so only their presence is checked.
// Usage: node scripts/dryrun-20261029160000.mjs [path/to/.env.local]
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(process.argv[2] ?? ".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const tryq = async (sql, p) => {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, p);
    await c.query("release savepoint s");
    return { n: r.rowCount, rows: r.rows };
  } catch (e) {
    await c.query("rollback to savepoint s");
    return { err: e.message };
  }
};
const sql = readFileSync("supabase/migrations/20261029160000_catalog_additions.sql", "utf8");
const [sales] = (
  await c.query(`select e.auth_user_id uid from employees e join roles r on r.id = e.role_id where r.english_name = 'sales' and e.status = 'Active' and e.auth_user_id is not null limit 1`)
).rows;
const [emp] = (await c.query(`select id from employees where status = 'Active' limit 1`)).rows;
await c.query("begin");
try {
  await c.query(sql);
  await c.query(sql);
  check("applies twice", true);
  const kinds = (await c.query(`select e.enumlabel k from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'term_kind'`)).rows.map((r) => r.k);
  check("term_kind has payment and bank", kinds.includes("payment") && kinds.includes("bank"), kinds.join(","));
  check("a pending addition is saved", (await tryq(`insert into catalog_additions (kind, typed_text, name, created_by) values ('view', 'اطلاله بحر', 'إطلالة على البحر', $1)`, [emp?.id ?? null])).n === 1);
  check("an unknown kind is refused", !!(await tryq(`insert into catalog_additions (kind, typed_text, name) values ('car', 'x', 'x')`)).err);
  check("an empty name is refused", !!(await tryq(`insert into catalog_additions (kind, typed_text, name) values ('room', 'x', '')`)).err);
  if (sales) {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: sales.uid, role: "authenticated" })]);
    await c.query(`set local role authenticated`);
    const r = await tryq(`select 1 from catalog_additions`);
    check("a salesperson's session reads none", !!r.err || r.n === 0, r.err ?? `rows ${r.n}`);
  } else check("a salesperson's session reads none", false, "no active sales employee to test with");
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(results.join("\n"));
console.log("rolled back — nothing kept");
