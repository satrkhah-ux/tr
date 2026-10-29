// Dry-runs supabase/migrations/20261029140300_pay_now.sql in ONE transaction that is ALWAYS rolled back, and
// checks what must hold after it. Nothing persists. The real apply is the coordinator's (backup first).
//
// Usage: node scripts/dry-run-pay-now.mjs
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

const sql = readFileSync(join(root, "supabase/migrations/20261029140300_pay_now.sql"), "utf8");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const one = async (q, p) => (await c.query(q, p)).rows[0];
let ok = true;
const check = (label, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) ok = false;
};

try {
  await c.query("begin");
  const before = await one("select count(*)::int n from public.payment_links");
  await c.query(sql);
  const after = await one("select count(*)::int n, count(offer_id)::int o from public.payment_links");
  check(`every existing link (${before.n}) got its offer`, after.n === before.n && after.o === after.n);
  const cols = await c.query(
    "select column_name, is_nullable from information_schema.columns where table_schema='public' and table_name='payment_links' and column_name in ('offer_id','operation_id','paid_amount','paid_on')",
  );
  const col = Object.fromEntries(cols.rows.map((r) => [r.column_name, r.is_nullable]));
  check("offer_id not null, operation_id nullable, paid_amount/paid_on added", col.offer_id === "NO" && col.operation_id === "YES" && col.paid_amount === "YES" && col.paid_on === "YES");
  const mf = await one("select used_by, notes from public.integrations where name = 'ماي فاتورة MyFatoorah'");
  check("«الربط الخارجي»: MyFatoorah row names the public /pay page", Boolean(mf?.notes?.includes("/pay/") && mf?.used_by?.includes("/pay/")));
  await c.query(sql);
  const again = await one("select (length(notes) - length(replace(notes, '/pay/<الرقم> صفحة', '')))::int n from public.integrations where name = 'ماي فاتورة MyFatoorah'");
  check("applying twice adds the note once", again.n === "/pay/<الرقم> صفحة".length);
  // a link made before any case: offer only, then paid and held, then carried once
  const offer = await one("select id from public.offers where partner_company_id is null order by created_at desc limit 1");
  await c.query(
    "insert into public.payment_links (offer_id, provider, invoice_id, amount, url, mock) values ($1, 'myfatoorah', 'dry-run-pay-now', 100, 'https://example.invalid', true)",
    [offer.id],
  );
  await c.query("update public.payment_links set status='paid', paid_amount=100, paid_on=current_date where invoice_id='dry-run-pay-now'");
  const held = await one("select count(*)::int n from public.payment_links where offer_id=$1 and status='paid' and payment_id is null and invoice_id='dry-run-pay-now'", [offer.id]);
  check("a link paid before the case is kept on the offer", held.n === 1);
  let dup = false;
  try {
    await c.query("savepoint s");
    await c.query("insert into public.payment_links (offer_id, provider, invoice_id, amount, url) values ($1, 'myfatoorah', 'dry-run-pay-now', 100, 'x')", [offer.id]);
  } catch (e) {
    dup = e.code === "23505";
    await c.query("rollback to savepoint s");
  }
  check("the same invoice twice → refused (23505)", dup);
} catch (e) {
  console.error("✗ failed:", e.message);
  ok = false;
} finally {
  await c.query("rollback");
  await c.end();
}
console.log(ok ? "ALL PASSED (rolled back — nothing persisted)" : "FAILED (rolled back)");
process.exit(ok ? 0 : 1);
