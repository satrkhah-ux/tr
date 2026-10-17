// Dry run of 0081 on the live database inside ONE transaction that is always
// rolled back. «مبيعات» is given operations.manage_own (as the owner will tick
// it), one of the latest operations' offers is made a real salesperson's, and a
// booking with its cost columns, a payment and an installment are added to that
// case and to a colleague's; the doors are shown shut, 0081 is applied (twice —
// it is idempotent), and the salesperson and the owner act through their own
// sessions (request.jwt.claims + role authenticated: RLS, grants and triggers as
// PostgREST applies them). Then the key is taken away again inside a savepoint —
// the revoke path — and 0078/0080 must hold as before. Nothing survives the ROLLBACK.
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

const [sales] = await q(`
  select e.id as emp, e.auth_user_id as uid from employees e join roles r on r.id = e.role_id
   where r.english_name = 'sales' and e.status = 'Active' and e.auth_user_id is not null limit 1`);
const [owner] = await q(`
  select e.id as emp, e.auth_user_id as uid from employees e join roles r on r.id = e.role_id
   where r.english_name = 'All Permissions' and e.status = 'Active' and e.auth_user_id is not null limit 1`);
const [anyOp] = await q(`select id as op, offer_id from operations order by created_at desc limit 1`);
if (!sales || !owner || !anyOp) throw new Error(`need a salesperson, the owner and an operation: ${JSON.stringify({ sales, owner, anyOp })}`);
const mine = { ...sales, ...anyOp };

const as = async (uid) => {
  await c.query(`reset role`);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
  await c.query(`set local role authenticated`);
};
const asDb = async () => {
  await c.query(`reset role`);
  await c.query(`select set_config('request.jwt.claims', '', true)`);
};
/** a statement in its own savepoint; `keep` false undoes even a success (a probe). */
const tryRows = async (sql, p, keep = true) => {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, p);
    await c.query(keep ? "release savepoint s" : "rollback to savepoint s");
    return { n: r.rowCount };
  } catch (e) {
    await c.query("rollback to savepoint s");
    return { err: e.message.slice(0, 160) };
  }
};
/** refused: an error (RLS with-check, a trigger), or no row reached (RLS using). */
const refused = (r) => !!r.err || r.n === 0;
const done = (r) => r.n === 1;
const s = (r) => JSON.stringify(r);
const KEYS = (op) => `update roles set permission_keys = ${op} where english_name = 'sales'`;

await c.query("begin");
try {
  // ---- the scene, as the database owner (auth.uid() null: no trigger stands in the way) ----
  const [{ keys }] = await q(`select permission_keys as keys from roles where english_name = 'sales'`);
  check("«مبيعات» holds operations.own (manage_own only matters beside it)", keys.includes("operations.own"), keys.join(","));
  await c.query(`update offers set employee_id = $1 where id = $2`, [mine.emp, mine.offer_id]);
  const [colleague] = await q(
    `select o.id as op, o.offer_id from operations o join offers f on f.id = o.offer_id
      where f.employee_id is distinct from $1 and o.id <> $2 order by o.created_at desc limit 1`,
    [mine.emp, mine.op],
  );
  if (!colleague) throw new Error("need a colleague's operation");
  await c.query(`update operations set client_status = 'confirmed', execution_status = 'pending_bookings' where id in ($1, $2)`, [mine.op, colleague.op]);
  const scene = async (op) => {
    const [bk] = await q(
      `insert into operation_bookings (operation_id, kind, title, source, status, client_reference, quoted_net, net_charged, currency, origin_ref, created_by)
       values ($1, 'hotel', 'dry-run hotel', 'manual', 'pending', 'TRV-' || gen_random_uuid(), 500, 450, 'SAR', 'hotel:dry', $2) returning id`,
      [op, mine.emp],
    );
    const [pay] = await q(`insert into operation_payments (operation_id, amount, kind) values ($1, 100, 'deposit') returning id`, [op]);
    const [inst] = await q(`insert into operation_installments (operation_id, due_date, amount) values ($1, current_date + 30, 100) returning id`, [op]);
    return { bk: bk.id, pay: pay.id, inst: inst.id };
  };
  const my = await scene(mine.op);
  const their = await scene(colleague.op);
  const plainBooking = `
    insert into operation_bookings (operation_id, kind, title, source, status, client_reference, currency, net_charged, created_by)
    values ($1, 'service', 'dry-run', 'manual', 'pending', 'TRV-' || gen_random_uuid(), 'SAR', 1, $2)`;

  // ---- the key on «مبيعات», 0081 not yet applied: 0078/0080 still shut every door ----
  await c.query(KEYS(`array(select distinct unnest(permission_keys || '{operations.manage_own}'))`));
  await as(mine.uid);
  let r = await tryRows(`update operations set client_status = 'cancelled' where id = $1`, [mine.op], false);
  check("before 0081: sales with the key still cannot cancel own case (0078)", refused(r), s(r));
  r = await tryRows(`insert into operation_payments (operation_id, amount, kind) values ($1, 10, 'refund')`, [mine.op], false);
  check("before 0081: … nor insert a refund (0078)", refused(r), s(r));
  r = await tryRows(`update operation_bookings set net_charged = 1 where id = $1`, [my.bk], false);
  check("before 0081: … nor change net_charged (0080)", refused(r), s(r));

  // ---- apply ----
  await asDb();
  const sql = readFileSync("supabase/migrations/0081_operations_manage_own.sql", "utf8");
  await c.query(sql);
  await c.query(sql);
  check("0081 applies, twice", true);

  // ---- the salesperson WITH manage_own, on their own case: the manager's steps land ----
  await as(mine.uid);
  const ownSteps = [
    ["cancel own case (client_status)", `update operations set client_status = 'cancelled', updated_at = now() where id = $1`, [mine.op]],
    ["cancel own case (execution_status)", `update operations set execution_status = 'cancelled', updated_at = now() where id = $1`, [mine.op]],
    ["insert a refund on own case", `insert into operation_payments (operation_id, amount, kind) values ($1, 10, 'refund')`, [mine.op]],
    ["correct a payment on own case", `update operation_payments set amount = 90, kind = 'installment', updated_at = now() where id = $1`, [my.pay]],
    ["delete a payment on own case", `delete from operation_payments where id = $1`, [my.pay]],
    ["saveInstallments on own case: delete", `delete from operation_installments where operation_id = $1`, [mine.op]],
    ["saveInstallments on own case: insert", `insert into operation_installments (operation_id, due_date, amount) values ($1, current_date + 10, 50)`, [mine.op]],
    ["change net_charged on own booking", `update operation_bookings set net_charged = 430 where id = $1`, [my.bk]],
    ["change every cost column on own booking", `update operation_bookings set quoted_net = 1, prebook_net = 1, currency = 'USD', origin_ref = 'hotel:x', supplier_confirmation_path = 'x/y.pdf' where id = $1`, [my.bk]],
    ["insert a booking carrying net_charged on own case", plainBooking, [mine.op, mine.emp]],
    ["change confirmed_at on own case", `update operations set confirmed_at = now() - interval '2 days' where id = $1`, [mine.op]],
    ["change travel_start on own case", `update operations set travel_start = coalesce(travel_start, current_date) + 7 where id = $1`, [mine.op]],
  ];
  for (const [name, stmt, p] of ownSteps) {
    r = await tryRows(stmt, p, false);
    check(`manage_own: ${name}`, done(r), s(r));
  }

  // ---- …and still nothing on a colleague's case ----
  const theirSteps = [
    ["cancel a colleague's case", `update operations set client_status = 'cancelled' where id = $1`, [colleague.op]],
    ["insert a refund on a colleague's case", `insert into operation_payments (operation_id, amount, kind) values ($1, 10, 'refund')`, [colleague.op]],
    ["correct a colleague's payment", `update operation_payments set amount = 1 where id = $1`, [their.pay]],
    ["delete a colleague's payment", `delete from operation_payments where id = $1`, [their.pay]],
    ["delete a colleague's installments", `delete from operation_installments where operation_id = $1`, [colleague.op]],
    ["insert an installment on a colleague's case", `insert into operation_installments (operation_id, due_date, amount) values ($1, current_date + 10, 50)`, [colleague.op]],
    ["change net_charged on a colleague's booking", `update operation_bookings set net_charged = 1 where id = $1`, [their.bk]],
    ["insert a booking carrying net_charged on a colleague's case", plainBooking, [colleague.op, mine.emp]],
    ["change confirmed_at on a colleague's case", `update operations set confirmed_at = now() where id = $1`, [colleague.op]],
    ["move own booking (with a new net) into a colleague's case", `update operation_bookings set operation_id = $2, net_charged = 2 where id = $1`, [my.bk, colleague.op]],
    ["point own case at a colleague's offer", `update operations set offer_id = $2 where id = $1`, [mine.op, colleague.offer_id]],
  ];
  for (const [name, stmt, p] of theirSteps) {
    r = await tryRows(stmt, p, false);
    check(`manage_own cannot ${name}`, refused(r), s(r));
  }
  r = await tryRows(`update offers set employee_id = null where id = $1`, [mine.offer_id], false);
  check("manage_own cannot change the issuer of own file in operations (offers_owner_locked unchanged)", refused(r), s(r));

  // ---- the revoke path: the key taken off «مبيعات» — 0078/0080 hold as before ----
  await asDb();
  await c.query("savepoint revoke");
  await c.query(KEYS(`array_remove(permission_keys, 'operations.manage_own')`));
  await as(mine.uid);
  const revoked = [
    ["cancel own case", `update operations set client_status = 'cancelled' where id = $1`, [mine.op]],
    ["insert a refund on own case", `insert into operation_payments (operation_id, amount, kind) values ($1, 10, 'refund')`, [mine.op]],
    ["correct a payment on own case", `update operation_payments set amount = 1 where id = $1`, [my.pay]],
    ["delete a payment on own case", `delete from operation_payments where id = $1`, [my.pay]],
    ["delete own case's installments", `delete from operation_installments where operation_id = $1`, [mine.op]],
    ["insert an installment on own case", `insert into operation_installments (operation_id, due_date, amount) values ($1, current_date + 10, 50)`, [mine.op]],
    ["change net_charged on own booking (0080)", `update operation_bookings set net_charged = 1 where id = $1`, [my.bk]],
    ["insert a booking carrying net_charged (0080)", plainBooking, [mine.op, mine.emp]],
    ["change confirmed_at on own case (0080)", `update operations set confirmed_at = now() where id = $1`, [mine.op]],
    ["change travel_start on own case (0080)", `update operations set travel_start = coalesce(travel_start, current_date) + 7 where id = $1`, [mine.op]],
  ];
  for (const [name, stmt, p] of revoked) {
    r = await tryRows(stmt, p, false);
    check(`without manage_own: cannot ${name}`, refused(r), s(r));
  }
  r = await tryRows(`insert into operation_payments (operation_id, amount, kind) values ($1, 10, 'deposit')`, [mine.op], false);
  check("without manage_own: still records money IN on own case (0078)", done(r), s(r));
  r = await tryRows(`update operations set client_status = 'paid_partial', updated_at = now() where id = $1`, [mine.op], false);
  check("without manage_own: still moves own case's status (0078)", done(r), s(r));
  await asDb();
  await c.query("rollback to savepoint revoke");

  // ---- the owner: unaffected, every case ----
  await as(owner.uid);
  const ownerSteps = [
    ["cancel a colleague's case", `update operations set client_status = 'cancelled' where id = $1`, [colleague.op]],
    ["insert a refund", `insert into operation_payments (operation_id, amount, kind) values ($1, 10, 'refund')`, [colleague.op]],
    ["correct a payment", `update operation_payments set amount = 1 where id = $1`, [their.pay]],
    ["delete a payment", `delete from operation_payments where id = $1`, [their.pay]],
    ["change net_charged", `update operation_bookings set net_charged = 1 where id = $1`, [their.bk]],
    ["change confirmed_at", `update operations set confirmed_at = now() where id = $1`, [colleague.op]],
  ];
  for (const [name, stmt, p] of ownerSteps) {
    r = await tryRows(stmt, p, false);
    check(`owner can ${name}`, done(r), s(r));
  }

  // ---- the service role / the app's server writes (no auth.uid()) ----
  await asDb();
  r = await tryRows(`update operation_bookings set net_charged = 2 where id = $1`, [their.bk], false);
  check("no session (service role): cost columns writable", done(r), s(r));
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(results.join("\n"));
console.log(results.some((l) => l.startsWith("FAIL")) ? "SOME CHECKS FAILED" : "all checks passed");
console.log("rolled back — nothing kept.");
