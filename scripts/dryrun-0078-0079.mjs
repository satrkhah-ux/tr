// Dry run of 0078 + 0079 on the live database inside ONE transaction that is
// always rolled back: apply both, give sales operations.own (as the role script
// will), then act as a real salesperson and as the owner and check what the
// database lets through. Nothing survives the ROLLBACK.
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

// a real salesperson; inside the transaction one operation's offer is made theirs
// (no sales file has reached operations yet) — rolled back with everything else
const [sales] = await q(`
  select e.id as emp, e.auth_user_id as uid from employees e join roles r on r.id = e.role_id
   where r.english_name = 'sales' and e.status = 'Active' and e.auth_user_id is not null limit 1`);
const [anyOp] = await q(`select id as op, offer_id from operations order by created_at desc limit 1`);
const mine = sales && anyOp ? { ...sales, ...anyOp } : null;
const [owner] = await q(`
  select e.auth_user_id as uid from employees e join roles r on r.id = e.role_id
   where r.english_name = 'All Permissions' and e.status = 'Active' and e.auth_user_id is not null limit 1`);
if (!mine || !owner) throw new Error(`need a sales file in operations and an owner: ${JSON.stringify({ mine, owner })}`);
const [other] = await q(
  `select o.id as op from operations o join offers f on f.id = o.offer_id where f.employee_id is distinct from $1 limit 1`,
  [mine.emp],
);
const [hotel] = await q(`select id from hotels limit 1`);
const [transfer] = await q(`select id from transfers limit 1`);

const as = async (uid) => {
  await c.query(`reset role`);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
  await c.query(`set local role authenticated`);
};
const tryRows = async (sql, p) => {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, p);
    await c.query("release savepoint s");
    return { n: r.rowCount };
  } catch (e) {
    await c.query("rollback to savepoint s");
    return { err: e.message.slice(0, 80) };
  }
};

await c.query("begin");
try {
  await c.query(`update offers set employee_id = $1 where id = $2`, [mine.emp, mine.offer_id]);
  await c.query(readFileSync("supabase/migrations/0078_operations_own.sql", "utf8"));
  await c.query(readFileSync("supabase/migrations/0079_data_delete_settings_manage.sql", "utf8"));
  await c.query(
    `update roles set permission_keys = array(select distinct unnest(permission_keys || '{operations.own}')) where english_name in ('sales', 'All Permissions')`,
  );
  check("both migrations apply", true);

  await as(mine.uid);
  let r = await tryRows(`update operations set updated_at = now() where id = $1`, [mine.op]);
  check("sales updates own operation", r.n === 1, JSON.stringify(r));
  r = other ? await tryRows(`update operations set updated_at = now() where id = $1`, [other.op]) : { n: 0 };
  check("sales cannot update a colleague's operation", r.n === 0 || !!r.err, JSON.stringify(r));
  r = await tryRows(`update operations set client_status = 'cancelled' where id = $1`, [mine.op]);
  check("sales cannot cancel own operation", !!r.err || r.n === 0, JSON.stringify(r));
  r = await tryRows(
    `insert into operation_issues (operation_id, description) values ($1, 'dry-run') returning id`,
    [mine.op],
  );
  check("sales logs an issue on own operation", r.n === 1, JSON.stringify(r));
  r = other ? await tryRows(`insert into operation_issues (operation_id, description) values ($1, 'dry-run')`, [other.op]) : { err: "no colleague op" };
  check("sales cannot log an issue on a colleague's operation", !!r.err, JSON.stringify(r));
  r = await tryRows(`update offers set employee_id = null where id = $1`, [mine.offer_id]);
  check("sales cannot change the issuer of a file in operations", !!r.err || r.n === 0, JSON.stringify(r));
  r = await tryRows(`delete from hotels where id = $1`, [hotel.id]);
  check("sales cannot delete a hotel", r.n === 0 || !!r.err, JSON.stringify(r));
  r = await tryRows(`update hotels set stars = stars where id = $1`, [hotel.id]);
  check("sales can still edit a hotel", r.n === 1, JSON.stringify(r));
  r = transfer ? await tryRows(`delete from transfers where id = $1`, [transfer.id]) : { n: 1 };
  check("sales (data.write) can clear a price-grid transfer", r.n === 1, JSON.stringify(r));
  r = await tryRows(`select public.merge_hotels($1, array[$1]::uuid[])`, [hotel.id]);
  check("sales cannot merge hotels", !!r.err, JSON.stringify(r));

  await as(owner.uid);
  r = await tryRows(`delete from hotels where id = $1`, [hotel.id]);
  check("the owner can delete a hotel", r.n === 1 || /foreign key|violates/.test(r.err ?? ""), JSON.stringify(r));
  r = other ? await tryRows(`update operations set updated_at = now() where id = $1`, [other.op]) : { n: 1 };
  check("the owner (operations.write) updates any operation", r.n === 1, JSON.stringify(r));
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(results.join("\n"));
console.log("rolled back — nothing kept.");
