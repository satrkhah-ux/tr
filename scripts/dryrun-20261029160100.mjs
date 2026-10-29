// Dry run of 20261029160100 («الشروط المالية» milestones + 'instalment') on top
// of 20261029160000, in one rolled-back transaction: both applied twice, the
// milestone columns accept a real milestone and refuse a bad one.
// New enum values cannot be USED in the transaction that adds them, so the
// rows tested are of the existing kind 'term'.
// Usage: node scripts/dryrun-20261029160100.mjs [path/to/.env.local]
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
const first = readFileSync("supabase/migrations/20261029160000_catalog_additions.sql", "utf8");
const sql = readFileSync("supabase/migrations/20261029160100_finance_terms.sql", "utf8");
await c.query("begin");
try {
  await c.query(first);
  await c.query(sql);
  await c.query(sql);
  check("applies twice after 20261029160000", true);
  const kinds = (await c.query(`select e.enumlabel k from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'term_kind'`)).rows.map((r) => r.k);
  check("term_kind has instalment", kinds.includes("instalment"), kinds.join(","));
  const cols = (await c.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'terms' and column_name like 'due_%'`)).rows.map((r) => r.column_name).sort();
  check("milestone columns", cols.join(",") === "due_amount,due_days,due_percent,due_when", cols.join(","));
  check("a milestone is saved", (await tryq(`insert into terms (kind, arabic_text, due_when, due_days, due_percent) values ('term', 'الباقي', 'before_travel', 14, 50)`)).n === 1);
  check("an unknown milestone is refused", !!(await tryq(`insert into terms (kind, arabic_text, due_when) values ('term', 'x', 'someday')`)).err);
  check("a percent over 100 is refused", !!(await tryq(`insert into terms (kind, arabic_text, due_percent) values ('term', 'x', 150)`)).err);
  check("a negative amount is refused", !!(await tryq(`insert into terms (kind, arabic_text, due_amount) values ('term', 'x', -5)`)).err);
  check("old rows untouched (no milestone)", (await c.query(`select count(*)::int n from terms where due_when is not null and arabic_text <> 'الباقي'`)).rows[0].n === 0);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(results.join("\n"));
console.log("rolled back — nothing kept");
