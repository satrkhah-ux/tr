// Dry run of 0092 («العمولات») on the live database inside ONE transaction that
// is always rolled back: applied twice (idempotent), the cycle's money rules
// hold even for the service role (frozen snapshot, legal steps, adjustments
// only in draft, one payout, four-eyes policy), and a salesperson's own
// session reads none of it. Nothing survives the ROLLBACK.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const tryRows = async (sql, p) => {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, p);
    await c.query("release savepoint s");
    return { n: r.rowCount, rows: r.rows };
  } catch (e) {
    await c.query("rollback to savepoint s");
    return { err: e.message.slice(0, 160) };
  }
};

const [sales] = await q(`
  select e.id as emp, e.auth_user_id as uid from employees e join roles r on r.id = e.role_id
   where r.english_name = 'sales' and e.status = 'Active' and e.auth_user_id is not null limit 1`);
const [other] = await q(`select id from employees where id <> $1 limit 1`, [sales.emp]);

const sql = readFileSync("supabase/migrations/0092_commissions.sql", "utf8");
await c.query("begin");
try {
  await c.query(sql);
  await c.query(sql);
  check("0092 applies twice (idempotent)", true);

  const [{ keys }] = await q(`select permission_keys as keys from roles where english_name = 'sales'`);
  check("sales role gets commissions.view only", keys.includes("commissions.view") && !keys.includes("commissions.manage"), keys.filter((k) => k.startsWith("comm")).join(","));

  const cyc = (await q(`insert into commission_cycles (month) values ('2099-01') returning id`))[0].id;
  check("a second live cycle for the month is refused", !!(await tryRows(`insert into commission_cycles (month) values ('2099-01')`)).err);
  check("draft → review without a snapshot is refused", !!(await tryRows(`update commission_cycles set status='review' where id=$1`, [cyc])).err);
  check("draft → paid is refused", !!(await tryRows(`update commission_cycles set status='paid', snapshot='{}' where id=$1`, [cyc])).err);
  const adj = await tryRows(`insert into commission_adjustments (cycle_id, employee_id, amount, reason) values ($1,$2,100,'test') returning id`, [cyc, sales.emp]);
  check("an adjustment in draft is taken", adj.n === 1, adj.err);
  check("an adjustment with no reason is refused", !!(await tryRows(`insert into commission_adjustments (cycle_id, employee_id, amount, reason) values ($1,$2,5,' ')`, [cyc, sales.emp])).err);
  const rev = await tryRows(`update commission_cycles set status='review', snapshot='{"a":1}' where id=$1`, [cyc]);
  check("draft → review with a snapshot", rev.n === 1, rev.err);
  check("a frozen snapshot cannot change", !!(await tryRows(`update commission_cycles set snapshot='{"a":2}' where id=$1`, [cyc])).err);
  check("the cost of a frozen month cannot change", !!(await tryRows(`update commission_cycles set monthly_cost=1 where id=$1`, [cyc])).err);
  check("adjustments are refused once frozen", !!(await tryRows(`insert into commission_adjustments (cycle_id, employee_id, amount, reason) values ($1,$2,5,'x')`, [cyc, sales.emp])).err);
  check("review → approved", (await tryRows(`update commission_cycles set status='approved' where id=$1`, [cyc])).n === 1);
  check("one payout", (await tryRows(`insert into commission_payouts (cycle_id, amount) values ($1, 10)`, [cyc])).n === 1);
  check("a second payout is refused", !!(await tryRows(`insert into commission_payouts (cycle_id, amount) values ($1, 10)`, [cyc])).err);
  check("approved → paid", (await tryRows(`update commission_cycles set status='paid' where id=$1`, [cyc])).n === 1);
  check("a paid cycle is final", !!(await tryRows(`update commission_cycles set status='void', void_reason='x' where id=$1`, [cyc])).err);

  check("nobody approves the policy they wrote", !!(await tryRows(`insert into commission_policies (doc, created_by, approved_by, status) values ('{}', $1, $1, 'approved')`, [sales.emp])).err);
  check("someone else may", (await tryRows(`insert into commission_policies (doc, created_by, approved_by, status) values ('{}', $1, $2, 'approved')`, [sales.emp, other.id])).n === 1);
  check("only one approved policy", !!(await tryRows(`insert into commission_policies (doc, status) values ('{}', 'approved')`)).err);

  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: sales.uid, role: "authenticated" })]);
  await c.query(`set local role authenticated`);
  for (const t of ["commission_cycles", "commission_policies", "commission_adjustments", "commission_payouts"]) {
    const r = await tryRows(`select 1 from ${t} limit 1`);
    check(`a salesperson's session reads nothing from ${t}`, !!r.err || r.n === 0, r.err ?? `rows ${r.n}`);
  }
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(results.join("\n"));
console.log("rolled back — nothing kept");
