// Dry run of 20261030100000 («أهداف المبيعات» closed table) in one rolled-back
// transaction: applied twice, the app_settings JSON copied once (bad entries
// skipped, an existing row kept), the constraints hold, the table is closed to
// anon/authenticated, and the app's upsert/delete shapes work (one standing
// target per employee — null month is NOT distinct).
// On a throwaway pg without the app schema, the few things it needs (employees,
// app_settings, the anon/authenticated roles) are stubbed inside the same transaction.
// Usage: node scripts/dryrun-20261030100000.mjs [path/to/.env.local]   (SUPABASE_DB_URL)
//        DRYRUN_DB_URL=postgres://… node scripts/dryrun-20261030100000.mjs
import { readFileSync } from "node:fs";
import pg from "pg";

let url = process.env.DRYRUN_DB_URL;
if (!url) {
  const env = Object.fromEntries(
    readFileSync(process.argv[2] ?? ".env.local", "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
  url = env.SUPABASE_DB_URL;
}
const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
const c = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
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
const sql = readFileSync("supabase/migrations/20261030100000_sales_targets.sql", "utf8");
await c.query("begin");
try {
  if (!(await c.query(`select to_regclass('public.employees') r`)).rows[0].r) {
    for (const role of ["anon", "authenticated"]) {
      if (!(await c.query(`select 1 from pg_roles where rolname = $1`, [role])).rowCount) await c.query(`create role ${role}`);
    }
    await c.query(`create table public.employees (id uuid primary key default gen_random_uuid(), arabic_name text, status text default 'Active')`);
    await c.query(`create table public.app_settings (key text primary key, value text not null, updated_at timestamptz not null default now())`);
    await c.query(`grant all on public.employees, public.app_settings to anon, authenticated`);
    check("stubbed employees/app_settings (throwaway pg)", true);
  }
  // two made-up employees, a JSON with good and bad entries, and one row already in place
  const [a, b] = (await c.query(`insert into public.employees (arabic_name, status) values ('تجربة أ', 'Active'), ('تجربة ب', 'Active') returning id`)).rows.map((r) => r.id);
  const ghost = "00000000-0000-0000-0000-000000000001";
  const json = { monthly: { [a]: 50000, [b]: "x", [ghost]: 1000 }, months: { "2026-11": { [a]: 70000, [b]: 30000 }, "2026-13": { [a]: 1 }, "2026-12": { [b]: -5 } } };
  const had = (await c.query(`select value from public.app_settings where key = 'sales_targets'`)).rows[0]?.value ?? null;
  await c.query(`insert into public.app_settings (key, value) values ('sales_targets', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(json)]);
  check("app_settings.sales_targets before", true, had === null ? "none" : `${had.length} chars — replaced by test JSON inside the rollback`);

  await c.query(sql);
  // a manager edit between two runs must survive the second run
  await c.query(`update public.sales_targets set amount = 55555 where employee_id = $1 and month is null`, [a]);
  await c.query(sql);
  check("applies twice", true);

  const rows = (await c.query(`select employee_id, to_char(month, 'YYYY-MM') m, amount::float8 amount from public.sales_targets where employee_id = any($1) order by employee_id, month nulls first`, [[a, b]])).rows;
  const got = rows.map((r) => `${r.employee_id === a ? "a" : "b"}:${r.m ?? "std"}=${r.amount}`).sort().join(",");
  check("copied: a std, a 2026-11, b 2026-11; bad entries skipped", got === "a:2026-11=70000,a:std=55555,b:2026-11=30000", got);
  check("second run kept the edited row", rows.find((r) => r.employee_id === a && r.m === null)?.amount === 55555);
  check("unknown employee skipped", (await c.query(`select count(*)::int n from public.sales_targets where employee_id = $1`, [ghost])).rows[0].n === 0);
  check("app_settings key kept", (await c.query(`select count(*)::int n from public.app_settings where key = 'sales_targets'`)).rows[0].n === 1);

  // the app's writes (commission-actions.ts setSalesTarget)
  const up = `insert into public.sales_targets (employee_id, month, amount) values ($1, $2, $3) on conflict (employee_id, month) do update set amount = excluded.amount, updated_at = now()`;
  check("upsert standing target (null month) updates in place", (await tryq(up, [b, null, 40000])).n === 1 && (await tryq(up, [b, null, 42000])).n === 1
    && (await c.query(`select count(*)::int n, max(amount)::float8 x from public.sales_targets where employee_id = $1 and month is null`, [b])).rows[0].x === 42000);
  check("one standing target per employee", !!(await tryq(`insert into public.sales_targets (employee_id, month, amount) values ($1, null, 1)`, [b])).err);
  check("month must be the 1st", !!(await tryq(`insert into public.sales_targets (employee_id, month, amount) values ($1, '2026-12-15', 1)`, [b])).err);
  check("amount 0 refused", !!(await tryq(`insert into public.sales_targets (employee_id, month, amount) values ($1, '2027-01-01', 0)`, [b])).err);
  check("delete one month leaves the standing target", (await tryq(`delete from public.sales_targets where employee_id = $1 and month = '2026-11-01'`, [b])).n === 1
    && (await c.query(`select count(*)::int n from public.sales_targets where employee_id = $1`, [b])).rows[0].n === 1);

  // closed: RLS on, no policy, no grant to the browser roles
  const rls = (await c.query(`select relrowsecurity r from pg_class where oid = 'public.sales_targets'::regclass`)).rows[0].r;
  const policies = (await c.query(`select count(*)::int n from pg_policies where schemaname = 'public' and tablename = 'sales_targets'`)).rows[0].n;
  check("RLS on, no policies", rls && policies === 0, `rls=${rls} policies=${policies}`);
  for (const role of ["anon", "authenticated"]) {
    const g = (await c.query(`select has_table_privilege($1, 'public.sales_targets', 'select') s, has_table_privilege($1, 'public.sales_targets', 'insert') i`, [role])).rows[0];
    check(`${role} cannot read or write`, !g.s && !g.i);
  }
  await c.query("savepoint r");
  await c.query("set local role authenticated");
  const denied = await c.query(`select count(*) from public.sales_targets`).then(() => false, () => true);
  await c.query("rollback to savepoint r");
  check("authenticated select is denied", denied);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(results.join("\n"));
console.log("rolled back — nothing kept");
