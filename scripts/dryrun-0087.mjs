// Dry run of 0087 («العملاء») on the live database inside ONE transaction that
// is always rolled back: the table is created (twice — idempotent), a
// salesperson logs, reads and updates a conversation through their own session
// (request.jwt.claims + role authenticated), a non-employee session sees and
// writes nothing, and nobody can delete. Nothing survives the ROLLBACK.
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
// an auth user with no employee row (a partner login), else a made-up uid
const [outsider] = await q(`select u.id as uid from auth.users u where not exists (select 1 from employees e where e.auth_user_id = u.id) limit 1`);
const outsiderUid = outsider?.uid ?? "00000000-0000-0000-0000-000000000001";
if (!sales) throw new Error("need an active salesperson with a login");

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
    return { n: r.rowCount, rows: r.rows };
  } catch (e) {
    await c.query("rollback to savepoint s");
    return { err: e.message.slice(0, 160) };
  }
};

const sql = readFileSync("supabase/migrations/0087_client_leads.sql", "utf8");
await c.query("begin");
try {
  await c.query(sql);
  await c.query(sql);
  check("0087 applies twice (idempotent)", true);

  await as(sales.uid);
  const ins = await tryRows(`insert into client_leads (phone, inquiry, destination, received_by, created_by) values ('966500000000', 'باكدج', 'ماليزيا', $1, $1) returning id`, [sales.emp]);
  check("a salesperson logs a conversation", ins.n === 1, ins.err);
  const id = ins.rows?.[0]?.id;
  const read = await tryRows(`select id from client_leads where id = $1`, [id]);
  check("…and reads it", read.n === 1, read.err);
  const upd = await tryRows(`update client_leads set status = 'closed' where id = $1`, [id]);
  check("…and closes it", upd.n === 1, upd.err);
  const bad = await tryRows(`update client_leads set status = 'gone' where id = $1`, [id]);
  check("an unknown status is refused", !!bad.err);
  const del = await tryRows(`delete from client_leads where id = $1`, [id]);
  check("nobody deletes a conversation", !!del.err || del.n === 0, del.err ?? `rows ${del.n}`);

  await as(outsiderUid);
  const seen = await tryRows(`select id from client_leads`);
  check("a non-employee session sees nothing", seen.n === 0, seen.err);
  const wrote = await tryRows(`insert into client_leads (phone) values ('966500000001')`);
  check("…and writes nothing", !!wrote.err, wrote.err);
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(results.join("\n"));
console.log("rolled back — nothing kept");
