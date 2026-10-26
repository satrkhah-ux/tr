// Dry-runs scripts/legacy-import-transport.sql: applies it INSIDE a transaction,
// reads the before/after counts, then ALWAYS rolls back. Nothing persists.
// The real apply (after the owner's explicit yes + a backup) is db-apply.mjs.
//
// Usage: node scripts/transport-dry-run.mjs
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

const sql = readFileSync(join(root, "scripts/legacy-import-transport.sql"), "utf8")
  .replace(/^begin;$/m, "")
  .replace(/^commit;$/m, "");

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const counts = async () => {
  const { rows } = await c.query(`select
    (select count(*)::int from public.country_vehicles) as capacities,
    (select count(*)::int from public.tour_prices where not provisional) as tour_prices_real,
    (select count(*)::int from public.tour_prices where provisional) as tour_prices_placeholder,
    (select count(*)::int from public.tours where provisional) as tours_placeholder,
    (select count(*)::int from public.tours where city_id is null) as tours_no_city,
    (select count(*)::int from public.transfers where provisional) as transfers_placeholder,
    (select count(*)::int from public.guide_informations) as guides`);
  return rows[0];
};

try {
  await c.query("begin");
  // the migration too (DDL rolls back with the transaction), so the dry run
  // works before 20261026120000 is applied to the live database
  await c.query(readFileSync(join(root, "supabase/migrations/20261026120000_country_vehicles.sql"), "utf8"));
  const before = await counts();
  await c.query(sql);
  const after = await counts();
  console.log("dry run (rolled back) — before → after:");
  for (const k of Object.keys(before)) console.log(`  ${k.padEnd(24)} ${String(before[k]).padStart(6)} → ${after[k]}`);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log("rolled back; nothing changed.");
