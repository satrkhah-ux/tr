// Dry run of 0101 («المطار» requests) inside one rolled-back transaction:
// applied twice, two lines share a request_ref, an unknown request_kind is refused.
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
const sql = readFileSync("supabase/migrations/0101_almatar_requests.sql", "utf8");
await c.query("begin");
try {
  await c.query(sql);
  await c.query(sql);
  check("0101 applies twice", true);
  const [am] = (await c.query(`select id from booking_partners where slug = 'almatar'`)).rows;
  const row = (svc, kind) =>
    c.query(
      `insert into almatar_bookings (partner_id, service_id, vehicle, units, service_date, service_time, service_at, passengers, lead_name, unit_price, total_sar, margin_pct, profit_sar, request_ref, request_kind)
       values ($1, $2, 'small', 1, '2099-01-01', '10:00', '2099-01-01 03:00+00', 2, 'T', 130, 130, 15, 19.5, 'R-TEST', $3) returning ref`,
      [am.id, svc, kind],
    );
  await row("th-01", "both");
  await row("th-02", "both");
  const n = (await c.query(`select count(*)::int n from almatar_bookings where request_ref = 'R-TEST'`)).rows[0].n;
  check("two lines share one request", n === 2, String(n));
  await c.query("savepoint s");
  try {
    await row("th-03", "cruise");
    check("an unknown request kind is refused", false);
  } catch {
    await c.query("rollback to savepoint s");
    check("an unknown request kind is refused", true);
  }
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(results.join("\n"));
console.log("rolled back — nothing kept");
