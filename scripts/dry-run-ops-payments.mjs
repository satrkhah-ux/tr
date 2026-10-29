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
const gatewaysSql = readFileSync(join(root, "supabase/migrations/20261029140100_payment_providers_integrations.sql"), "utf8");
const linksSql = readFileSync(join(root, "supabase/migrations/20261029140200_payment_links.sql"), "utf8");
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
  const sc = await one(
    "select data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='operation_payments' and column_name='expected_settlement_on'",
  );
  check("operation_payments.expected_settlement_on exists, a nullable date", sc?.data_type === "date" && sc?.is_nullable === "YES");
  await c.query(gatewaysSql);
  const gw = await one("select count(*)::int n from public.integrations where check_key in ('myfatoorah', 'tamara')");
  check("«الربط الخارجي»: MyFatoorah and Tamara rows point at their checks («افحص الآن»)", gw.n === 2);
  await c.query(linksSql);
  const lt = await one("select relrowsecurity r from pg_class where oid = 'public.payment_links'::regclass");
  check("payment_links exists with RLS on", lt?.r === true);
  const grants = await one("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and table_name='payment_links' and grantee in ('anon','authenticated')");
  check("payment_links: no grant to anon/authenticated", grants.n === 0);
  const ux = await one("select indexdef d from pg_indexes where schemaname='public' and indexname='operation_payments_provider_ref_key'");
  check("operation_payments.provider_ref is unique", Boolean(ux?.d?.includes("UNIQUE")));
  const op = await one("select id from public.operations limit 1");
  if (op) {
    await c.query("savepoint dup");
    const ins = "insert into public.operation_payments (operation_id, amount, kind, method, paid_at, provider_ref) values ($1, 1, 'deposit', 'link', current_date, 'myfatoorah:dry-run')";
    await c.query(ins, [op.id]);
    let second = "inserted";
    try {
      await c.query(ins, [op.id]);
    } catch (e) {
      second = e.code;
    }
    await c.query("rollback to savepoint dup");
    check(`a paid link twice → the second insert refused (${second})`, second === "23505");
  }
  const reg = await one("select count(*)::int n from public.integrations where check_key = 'job_payment_links'");
  check("«الربط الخارجي» lists the job", reg.n === 1);
  const after = await one("select count(*)::int n from public.operation_payments");
  check(`no payment row touched (${before.n} before, ${after.n} after)`, before.n === after.n);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(ok ? "dry run passed — rolled back, nothing changed." : "dry run FAILED — rolled back, nothing changed.");
process.exit(ok ? 0 : 1);
