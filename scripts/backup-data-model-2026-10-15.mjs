// Backup before 0072 (data orders 4–9) — read-only. The definitions it touches,
// and a rollback script, to data-import/backups/data-model-2026-10-15/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const dir = "data-import/backups/data-model-2026-10-15";
mkdirSync(dir, { recursive: true });
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
const tables = ["room_types", "airports", "transfers", "tours", "drivers"];
const list = tables.map((t) => `'${t}'`).join(",");

const out = {
  taken_at: new Date().toISOString(),
  columns: await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name in (${list}) order by table_name, ordinal_position`),
  constraints: await q(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as d from pg_constraint where conrelid in (${tables.map((t) => `'public.${t}'::regclass`).join(",")})`),
  indexes: await q(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in (${list})`),
  new_tables_exist: await q(`select to_regclass('public.tour_prices')::text as tour_prices, to_regclass('public.visas')::text as visas`),
  counts: await q(`select (select count(*) from public.room_types)::int as room_types, (select count(*) from public.airports)::int as airports, (select count(*) from public.transfers)::int as transfers, (select count(*) from public.tours)::int as tours, (select count(*) from public.drivers)::int as drivers`),
};
writeFileSync(`${dir}/before.json`, JSON.stringify(out, null, 2));
if (out.new_tables_exist[0].tour_prices || out.new_tables_exist[0].visas) throw new Error("tour_prices or visas already exists — review before 0072");

writeFileSync(
  `${dir}/rollback.sql`,
  `-- Undo 0072. Only with the code that reads them NOT deployed (or tolerant of their absence).
begin;
drop table if exists public.tour_prices, public.visas;
alter table public.drivers drop column if exists city_id, drop column if exists supplier_id, drop column if exists status;
alter table public.tours drop column if exists city_id, drop column if exists program_id, drop column if exists duration_hours;
drop index if exists public.transfers_point_uidx;
alter table public.transfers drop constraint if exists transfers_point_check, drop column if exists from_kind, drop column if exists from_id, drop column if exists to_kind, drop column if exists to_id;
alter table public.airports drop constraint if exists airports_iata_check, drop constraint if exists airports_kind_check, drop column if exists kind;
alter table public.room_types drop constraint if exists room_types_category_check, drop column if exists category;
notify pgrst, 'reload schema';
commit;
`,
);
console.log(`backup: ${out.columns.length} columns, ${out.constraints.length} constraints, ${out.indexes.length} indexes; counts ${JSON.stringify(out.counts[0])}`);
await c.end();
