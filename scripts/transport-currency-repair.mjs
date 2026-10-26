// Repairs the 2026-10-26 tour-price contamination (the owner: «اسعار الجولات
// خطأ، مكتوب العملة متنوعة»): the first transport import matched GENERIC legacy
// tour names («الجولة الأولى») across countries, so Indonesian rupiah landed on
// Georgian tours. The legacy data itself is clean — one currency per country.
//
// What this does, in ONE transaction:
//   1. restore tour_prices entirely from data-import/backups/transport-2026-10-26
//   2. restore tours' (price, currency, provisional) from the same backup
//   3. re-apply scripts/legacy-import-transport.sql (regenerate it first!),
//      whose name-match now requires the SAME COUNTRY and skips generic names
//   4. print the per-country currency mix before and after
//
//   node scripts/transport-currency-repair.mjs            dry run (rolls back)
//   node scripts/transport-currency-repair.mjs --commit   persist (after the owner's yes)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backupDir = "C:/Users/al3r1/OneDrive/Desktop/Project/ai-website-cloner-template/data-import/backups/transport-2026-10-26";
const commit = process.argv.includes("--commit");

for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    let v = m[2].trim();
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const backupPrices = JSON.parse(readFileSync(join(backupDir, "tour_prices.json"), "utf8"));
const backupTours = JSON.parse(readFileSync(join(backupDir, "tours.json"), "utf8"));
const sql = readFileSync(join(root, "scripts/legacy-import-transport.sql"), "utf8")
  .replace(/^begin;$/m, "")
  .replace(/^commit;$/m, "");

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const mix = async () =>
  (await c.query(`select co.arabic_name as country, tp.currency, count(*)::int n
    from public.tour_prices tp join public.tours t on t.id = tp.tour_id
    left join public.countries co on co.id = t.country_id
    where not tp.provisional group by 1, 2 order by 1, 3 desc`)).rows;

try {
  await c.query("begin");
  console.log("before:"); console.table(await mix());

  // 1. tour_prices back to the pre-import state (the backup is the whole table)
  await c.query("delete from public.tour_prices");
  for (const r of backupPrices)
    await c.query(
      "insert into public.tour_prices (id, tour_id, car_type, price, currency, created_at, provisional) values ($1,$2,$3,$4,$5,$6,$7)",
      [r.id, r.tour_id, r.car_type, r.price, r.currency, r.created_at, r.provisional]);

  // 2. tours' price columns back (city_id stays: the map-based city links were correct)
  for (const r of backupTours)
    await c.query("update public.tours set price = $2, currency = $3, provisional = $4 where id = $1",
      [r.id, r.price, r.currency, r.provisional]);

  // 3. the corrected import
  await c.query(sql);

  console.log("after:"); console.table(await mix());
  const { rows: [sum] } = await c.query(`select
    (select count(*)::int from public.tour_prices where not provisional) real,
    (select count(*)::int from public.tour_prices where provisional) placeholder,
    (select count(*)::int from public.tours where provisional) tours_placeholder`);
  console.log(sum);

  if (commit) { await c.query("commit"); console.log("COMMITTED."); }
  else { await c.query("rollback"); console.log("dry run — rolled back, nothing changed."); }
} catch (e) {
  await c.query("rollback").catch(() => {});
  throw e;
} finally {
  await c.end();
}
