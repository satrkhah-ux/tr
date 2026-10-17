// Backup before 0078 + 0079 (2026-10-17): every policy on the tables they touch,
// merge_hotels' definition and the roles table, so both can be put back exactly.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const tables = [
  "operations", "operation_bookings", "operation_documents", "operation_dispatches", "operation_issues", "operation_payments", "offers",
  "countries", "cities", "hotels", "room_types", "airlines", "airports", "ports", "transportation_types", "drivers", "services",
  "service_types", "tours", "tour_programs", "company_suppliers", "visas", "terms", "transfers", "customers", "statuses",
  "supervisors", "guide_informations", "care_tickets", "city_climate_notes",
];
const policies = (await c.query(`select * from pg_policies where schemaname = 'public' and tablename = any($1)`, [tables])).rows;
const fns = (
  await c.query(
    `select p.proname, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('merge_hotels', 'owns_offer', 'owns_operation', 'offers_owner_locked', 'operation_bookings_money_locked', 'operations_money_locked')`,
  )
).rows;
const triggers = (await c.query(`select tgname, tgrelid::regclass::text as tbl from pg_trigger where tgname in ('offers_owner_locked', 'operation_bookings_money_locked', 'operations_money_locked')`)).rows;
const dir = process.argv[2] ?? "data-import/backups/policies-2026-10-17";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/before.json`, JSON.stringify({ taken_at: new Date().toISOString(), policies, functions: fns, triggers }, null, 1));
console.log(`policies: ${policies.length}, functions: ${fns.map((f) => f.proname).join(",")}, triggers: ${triggers.length} → ${dir}`);
await c.end();
