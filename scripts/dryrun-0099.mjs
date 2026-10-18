// Dry run of 0099 («المطار») on the live database inside ONE transaction that
// is always rolled back: applied twice (idempotent), 32 price lines with th-07
// flagged, no existing row touched (transfers / price_grid / tours counts and
// every other partner's portal unchanged), the group rule held by the table,
// and neither a package partner nor a salesperson reads an almatar_* row.
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
const counts = async () =>
  (await q(`select (select count(*) from transfers) t, (select count(*) from tours) r, (select count(*) from booking_partners) p,
                   (select count(*) from partner_users) u`))[0];

const [sales] = await q(`
  select e.auth_user_id as uid from employees e join roles r on r.id = e.role_id
   where r.english_name = 'sales' and e.status = 'Active' and e.auth_user_id is not null limit 1`);
const [partnerUser] = await q(`
  select pu.auth_user_id as uid, pu.partner_id from partner_users pu join booking_partners bp on bp.id = pu.partner_id
   where pu.status = 'active' and bp.status = 'approved' and pu.auth_user_id is not null limit 1`);

const sql = readFileSync("supabase/migrations/0099_almatar.sql", "utf8");
const before = await counts();
await c.query("begin");
try {
  await c.query(sql);
  await c.query(sql);
  check("0099 applies twice (idempotent)", true);

  const after = await counts();
  check("transfers / tours untouched", after.t === before.t && after.r === before.r, `${before.t}/${before.r}`);
  check("one partner row added, once", Number(after.p) === Number(before.p) + 1, `${before.p} → ${after.p}`);
  check("existing partners stay package partners", (await q(`select count(*)::int n from booking_partners where portal <> 'packages' and slug is distinct from 'almatar'`))[0].n === 0);

  const svc = await q(`select id, country_code, price_small, price_medium, price_van10, review_note from almatar_services order by sort`);
  check("32 price lines", svc.length === 32, String(svc.length));
  check("TH 7 / MY 15 / ID 10", ["TH", "MY", "ID"].map((cc) => svc.filter((s) => s.country_code === cc).length).join("/") === "7/15/10");
  const th07 = svc.find((s) => s.id === "th-07");
  check("th-07 kept as sent (215/335/280) and flagged", Number(th07.price_medium) === 335 && Number(th07.price_van10) === 280 && /للمراجعة/.test(th07.review_note ?? ""));
  check("only th-07 is flagged", svc.filter((s) => s.review_note).length === 1);
  check("margin starts at 15", Number((await q(`select margin_pct from almatar_settings`))[0].margin_pct) === 15);

  const [am] = await q(`select id from booking_partners where slug = 'almatar'`);
  const base = `insert into almatar_bookings (partner_id, service_id, vehicle, units, service_date, service_time, service_at, passengers, lead_name, unit_price, total_sar, margin_pct, profit_sar)
                values ($1, 'th-01', 'small', $2, '2099-01-01', '10:00', '2099-01-01 03:00+00', 2, 'Test', 130, 130, 15, 19.5) returning ref`;
  const ok = await tryRows(base, [am.id, 7]);
  check("a 7-vehicle booking is taken, ref AM-…", ok.n === 1 && /^AM-\d{5}$/.test(ok.rows[0].ref), ok.err ?? ok.rows?.[0]?.ref);
  check("8 vehicles (a group) is refused by the table", !!(await tryRows(base, [am.id, 8])).err);
  check("an unknown vehicle is refused", !!(await tryRows(base.replace("'small'", "'bus'"), [am.id, 1])).err);

  if (partnerUser) {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: partnerUser.uid, role: "authenticated" })]);
    await c.query(`set local role authenticated`);
    const own = await tryRows(`select public.current_partner_id() as id`);
    check("a package partner still resolves its company", own.rows?.[0]?.id === partnerUser.partner_id, own.err);
    for (const t of ["almatar_services", "almatar_bookings", "almatar_settings"]) {
      const r = await tryRows(`select 1 from ${t} limit 1`);
      check(`a package partner reads nothing from ${t}`, !!r.err || r.n === 0, r.err ?? `rows ${r.n}`);
    }
    await c.query(`reset role`);
  }

  // an Almatar login, simulated: it must resolve to NO package partner
  const fakeUid = "00000000-0000-4000-8000-0000000a1a7a";
  await q(`insert into partner_users (partner_id, auth_user_id, email, role) values ($1, $2, 'almatar-dryrun@partners.traveliun.com', 'owner')`, [am.id, fakeUid]);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: fakeUid, role: "authenticated" })]);
  await c.query(`set local role authenticated`);
  const amId = await tryRows(`select public.current_partner_id() as id`);
  check("an Almatar session is not a package partner (current_partner_id null)", amId.rows?.[0]?.id === null, amId.err);
  for (const t of ["almatar_services", "almatar_bookings", "offers", "offer_drafts"]) {
    const r = await tryRows(`select 1 from ${t} limit 1`);
    check(`an Almatar session reads nothing from ${t}`, !!r.err || r.n === 0, r.err ?? `rows ${r.n}`);
  }
  await c.query(`reset role`);

  if (sales) {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: sales.uid, role: "authenticated" })]);
    await c.query(`set local role authenticated`);
    for (const t of ["almatar_services", "almatar_bookings", "almatar_settings"]) {
      const r = await tryRows(`select 1 from ${t} limit 1`);
      check(`a salesperson's session reads nothing from ${t}`, !!r.err || r.n === 0, r.err ?? `rows ${r.n}`);
    }
  }
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(results.join("\n"));
console.log("rolled back — nothing kept");
