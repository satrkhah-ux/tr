// Dry run of 0102 («مخاطبة المورد») in one rolled-back transaction: applied
// twice, a message each way, an empty one refused, a salesperson reads none.
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
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const tryq = async (sql, p) => {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, p);
    await c.query("release savepoint s");
    return { n: r.rowCount };
  } catch (e) {
    await c.query("rollback to savepoint s");
    return { err: e.message };
  }
};
const sql = readFileSync("supabase/migrations/0102_almatar_messages.sql", "utf8");
const [sales] = (
  await c.query(`select e.auth_user_id uid from employees e join roles r on r.id = e.role_id where r.english_name = 'sales' and e.status = 'Active' and e.auth_user_id is not null limit 1`)
).rows;
await c.query("begin");
try {
  await c.query(sql);
  await c.query(sql);
  check("0102 applies twice", true);
  const [am] = (await c.query(`select id from booking_partners where slug = 'almatar'`)).rows;
  check("a message from Almatar", (await tryq(`insert into almatar_messages (partner_id, sender, body) values ($1, 'partner', 'hello')`, [am.id])).n === 1);
  check("an answer from us", (await tryq(`insert into almatar_messages (partner_id, sender, body) values ($1, 'staff', 'hi')`, [am.id])).n === 1);
  check("an empty message is refused", !!(await tryq(`insert into almatar_messages (partner_id, sender, body) values ($1, 'staff', '  ')`, [am.id])).err);
  if (sales) {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: sales.uid, role: "authenticated" })]);
    await c.query(`set local role authenticated`);
    const r = await tryq(`select 1 from almatar_messages`);
    check("a salesperson's session reads no message", !!r.err || r.n === 0, r.err ?? `rows ${r.n}`);
  }
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(results.join("\n"));
console.log("rolled back — nothing kept");
