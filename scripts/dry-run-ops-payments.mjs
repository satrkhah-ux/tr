// Dry-runs supabase/migrations/20261029140000_ops_payments.sql in ONE
// transaction that is ALWAYS rolled back, and checks what must hold after it.
// Nothing persists. The real apply is the coordinator's (backup first).
//
// Usage: node scripts/dry-run-ops-payments.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    let v = m[2].trim();
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const sql = readFileSync(join(root, "supabase/migrations/20261029140000_ops_payments.sql"), "utf8");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const one = async (q) => (await c.query(q)).rows[0];
let ok = true;
const check = (label, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) ok = false;
};

try {
  await c.query("begin");
  const before = await one("select count(*)::int n from public.operation_payments");
  await c.query(sql);
  const def = await one(
    "select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.operation_payments'::regclass and conname = 'operation_payments_method_check'",
  );
  check("method check lists all seven methods", ["tabby", "tamara", "pos", "card", "link", "cash", "transfer"].every((m) => def?.d.includes(`'${m}'`)));
  const col = await one(
    "select data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='operations' and column_name='agreed_total'",
  );
  check("operations.agreed_total exists, nullable", col?.data_type === "numeric" && col?.is_nullable === "YES");
  const set = await one("select count(*)::int n from public.operations where agreed_total is not null");
  check("no case has an agreed price yet — every case reads its offer total as before", set.n === 0);
  const after = await one("select count(*)::int n from public.operation_payments");
  check(`no payment row touched (${before.n} before, ${after.n} after)`, before.n === after.n);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(ok ? "dry run passed — rolled back, nothing changed." : "dry run FAILED — rolled back, nothing changed.");
process.exit(ok ? 0 : 1);
