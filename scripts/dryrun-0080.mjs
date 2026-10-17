// Dry run of 0080 on the live database inside ONE transaction that is always
// rolled back. One of the latest operations' offers is made a real salesperson's
// (no sales file has reached operations yet), and a booking with every cost
// column filled is added to it; the holes are shown open, 0080 is applied (twice
// — it is idempotent), and the salesperson and the owner act through their own
// sessions (request.jwt.claims + role authenticated: RLS, grants and triggers as
// PostgREST applies them). Nothing survives the ROLLBACK.
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
const refused = (r) => !!r.err && /0080|0078/.test(r.err);
const s = (r) => JSON.stringify(r);

const LOCKED_BOOKING = {
  quoted_net: "1",
  prebook_net: "1",
  net_charged: "1",
  currency: "'USD'",
  origin_ref: "'visa:00000000-0000-0000-0000-000000000000'",
  supplier_confirmation_path: "'receipts/x/y.pdf'",
};
/** addBooking's insert, optionally carrying one more column. */
const plainInsert = (col, val) => `
  insert into operation_bookings (operation_id, kind, title, source, status, client_reference, currency, created_by${col ? `, ${col}` : ""})
  values ($1, 'service', 'dry-run', 'manual', 'pending', 'TRV-' || gen_random_uuid(), 'SAR', $2${col ? `, ${val}` : ""})`;

await c.query("begin");
try {
  // ---- the scene, as the database owner (auth.uid() null: no trigger stands in the way) ----
  await c.query(`update offers set employee_id = $1 where id = $2`, [mine.emp, mine.offer_id]);
  const [bk] = await q(
    `insert into operation_bookings (operation_id, kind, title, source, status, client_reference, quoted_net, net_charged, currency, origin_ref, supplier_confirmation_path, created_by)
     values ($1, 'hotel', 'dry-run hotel', 'manual', 'pending', 'TRV-' || gen_random_uuid(), 500, 450, 'SAR', 'hotel:dry', 'confirmations/dry.pdf', $2) returning id`,
    [mine.op, mine.emp],
  );
  const [colleagueOffer] = await q(
    `select f.id from offers f where f.employee_id is not null and f.employee_id <> $1
        and not exists (select 1 from operations o where o.offer_id = f.id) limit 1`,
    [mine.emp],
  );
  const [ownLoose] = await q(
    `select f.id from offers f where f.employee_id is distinct from $1 and f.id <> $2
        and not exists (select 1 from operations o where o.offer_id = f.id) and f.id <> $3 limit 1`,
    [mine.emp, mine.offer_id, colleagueOffer.id],
  );
  await c.query(`update offers set employee_id = $1 where id = $2`, [mine.emp, ownLoose.id]); // a file of theirs not yet in operations
  const [issuerless] = await q(
    `select f.id from offers f where f.employee_id is null and not exists (select 1 from operations o where o.offer_id = f.id) limit 1`,
  );
  const [colleagueOp] = await q(
    `select o.id as op, o.offer_id from operations o join offers f on f.id = o.offer_id where f.employee_id is distinct from $1 limit 1`,
    [mine.emp],
  );

  // ---- before 0080: the leftovers are open ----
  await as(mine.uid);
  let r = await tryRows(`update operation_bookings set net_charged = 1 where id = $1`, [bk.id], false);
  check("before 0080: sales CAN rewrite net_charged on own booking (leftover 1)", r.n === 1, s(r));
  r = await tryRows(`update offers set employee_id = $1 where id = $2`, [mine.emp, colleagueOffer.id], false);
  check("before 0080: sales CAN take a colleague's offer not in operations (leftover 2)", r.n === 1, s(r));

  // ---- apply ----
  await asDb();
  const sql = readFileSync("supabase/migrations/0080_ops_money_columns_and_issuer.sql", "utf8");
  await c.query(sql);
  await c.query(sql);
  check("0080 applies, twice", true);

  // ---- the salesperson: every own-files write the app does still lands ----
  await as(mine.uid);
  const own = [
    ["updateBooking (title, city, dates, detail, supplier, policy, note)",
      `update operation_bookings set title = 'dry-run hotel 2', city_name = 'x', start_date = current_date, end_date = current_date + 2,
         detail = '{"a":"b"}', supplier_name = 'x', cancellation_policy = 'x', note = 'x' where id = $1`],
    ["confirm / «تأكيد الكل» without a net (status, number, confirmed_at/_by, deadline)",
      `update operation_bookings set status = 'confirmed', confirmation_number = 'DRY-1', confirmed_at = now(),
         confirmed_by = '${mine.emp}', cancellation_deadline = now() + interval '3 days' where id = $1`],
    ["markBookingPaid (is_paid, paid_at)", `update operation_bookings set is_paid = true, paid_at = now() where id = $1`],
    ["assignBooking (assignee_*, assigned_*, handoff_note)",
      `update operation_bookings set assignee_kind = 'employee', assignee_employee_id = '${mine.emp}', assignee_partner_id = null,
         assignee_supplier_id = null, assigned_at = now(), assigned_by = '${mine.emp}', handoff_note = 'x' where id = $1`],
    ["sendBookingRequest (request_status / _sent_at / _answered_at)",
      `update operation_bookings set request_status = 'sent', request_sent_at = now(), request_answered_at = null where id = $1`],
    // the values the scene wrote, as literals: a session cannot read the nets (0047)
    ["a PATCH that repeats the cost columns unchanged", `update operation_bookings set quoted_net = 500, net_charged = 450, currency = 'SAR' where id = $1`],
    ["cancelBooking (status, cancelled_at)", `update operation_bookings set status = 'cancelled', cancelled_at = now() where id = $1`],
  ];
  for (const [name, stmt] of own) {
    r = await tryRows(stmt, [bk.id]);
    check(`sales: ${name}`, r.n === 1, s(r));
  }
  r = await tryRows(plainInsert(), [mine.op, mine.emp]);
  check("sales: addBooking (a booking with no cost columns)", r.n === 1, s(r));
  r = await tryRows(`update operations set client_status = 'paid_partial', execution_status = 'hotels_booked', updated_at = now() where id = $1`, [mine.op]);
  check("sales: setClientStatus / setExecutionStatus on own case", r.n === 1, s(r));
  r = await tryRows(`update operations set assignee_id = $2, client_info = '{"phone":"1"}' where id = $1`, [mine.op, mine.emp]);
  check("sales: setCaseAssignee / saveClientInfo on own case", r.n === 1, s(r));

  // ---- the salesperson: every locked column refused ----
  for (const [col, val] of Object.entries(LOCKED_BOOKING)) {
    r = await tryRows(`update operation_bookings set ${col} = ${val} where id = $1`, [bk.id]);
    check(`sales cannot UPDATE operation_bookings.${col}`, refused(r), s(r));
  }
  r = await tryRows(`update operation_bookings set net_charged = null where id = $1`, [bk.id]);
  check("sales cannot clear net_charged either", refused(r), s(r));
  for (const [col, val] of Object.entries(LOCKED_BOOKING)) {
    if (col === "currency") continue; // a currency with no net costs nothing — addBooking names 'SAR'
    r = await tryRows(plainInsert(col, val), [mine.op, mine.emp]);
    check(`sales cannot INSERT a booking carrying ${col}`, refused(r), s(r));
  }
  for (const [col, val] of [["confirmed_at", "now() - interval '1 year'"], ["travel_start", "current_date + 400"]]) {
    r = await tryRows(`update operations set ${col} = ${val} where id = $1`, [mine.op]);
    check(`sales cannot UPDATE operations.${col}`, refused(r), s(r));
  }

  // ---- the salesperson and the issuer ----
  r = await tryRows(`update offers set employee_id = $1 where id = $2`, [mine.emp, colleagueOffer.id]);
  check("sales cannot take a colleague's offer (not in operations)", refused(r), s(r));
  r = issuerless ? await tryRows(`update offers set employee_id = $1 where id = $2`, [mine.emp, issuerless.id]) : { err: "0080 none to try" };
  check("sales cannot claim an issuer-less offer", refused(r), s(r));
  r = await tryRows(`update offers set employee_id = $1 where id = $2`, [mine.emp, colleagueOp.offer_id]);
  check("sales cannot take a colleague's offer in operations (0078 still)", refused(r), s(r));
  r = await tryRows(`update offers set employee_id = $1 where id = $2`, [owner.emp, ownLoose.id], false);
  check("sales may hand on its OWN offer not yet in operations", r.n === 1, s(r));
  r = await tryRows(`update offers set employee_id = null where id = $1`, [mine.offer_id]);
  check("sales cannot change the issuer of its own file in operations (0078)", refused(r), s(r));
  r = await tryRows(`update offers set destination = destination, employee_id = employee_id where id = $1`, [colleagueOffer.id]);
  check("sales: an offer edit that repeats the issuer unchanged", r.n === 1, s(r));

  // ---- the owner: all of it ----
  await as(owner.uid);
  for (const [col, val] of Object.entries(LOCKED_BOOKING)) {
    r = await tryRows(`update operation_bookings set ${col} = ${val} where id = $1`, [bk.id]);
    check(`owner can UPDATE operation_bookings.${col}`, r.n === 1, s(r));
  }
  r = await tryRows(plainInsert("net_charged", "1"), [mine.op, owner.emp]);
  check("owner can INSERT a booking carrying net_charged", r.n === 1, s(r));
  for (const [col, val] of [["confirmed_at", "now() - interval '1 year'"], ["travel_start", "current_date + 400"]]) {
    r = await tryRows(`update operations set ${col} = ${val} where id = $1`, [mine.op]);
    check(`owner can UPDATE operations.${col}`, r.n === 1, s(r));
  }
  r = await tryRows(`update offers set employee_id = $1 where id = $2`, [mine.emp, colleagueOffer.id]);
  check("owner can move a colleague's offer (not in operations)", r.n === 1, s(r));
  r = await tryRows(`update offers set employee_id = $1 where id = $2`, [owner.emp, colleagueOp.offer_id]);
  check("owner can move an offer in operations", r.n === 1, s(r));

  // ---- the service role / the app's server writes (no auth.uid()) ----
  await asDb();
  r = await tryRows(`update operation_bookings set net_charged = 2, currency = 'SAR', origin_ref = 'hotel:dry2' where id = $1`, [bk.id]);
  check("no session (service role, setBookingCost / the pull): cost columns writable", r.n === 1, s(r));
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(results.join("\n"));
console.log(results.some((l) => l.startsWith("FAIL")) ? "SOME CHECKS FAILED" : "all checks passed");
console.log("rolled back — nothing kept.");
