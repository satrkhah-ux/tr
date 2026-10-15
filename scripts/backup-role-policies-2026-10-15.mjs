// Backup before 0073 (role write policies) — read-only. Every policy and grant
// 0073 replaces, to data-import/backups/security-2026-10-15/0073-before.json.
// The rollback script is the comment block at the end of 0073 itself.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const dir = "data-import/backups/security-2026-10-15";
mkdirSync(dir, { recursive: true });
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
const tables = [
  "operations", "operation_payments", "operation_bookings", "operation_dispatches", "operation_documents",
  "operation_installments", "operation_alerts", "operation_issues", "operation_ratings", "operation_links",
  "supplier_payments", "hotel_rate_memory", "ready_offers", "partner_invoices", "partner_payments", "attendance_days", "offers",
];
const list = tables.map((t) => `'${t}'`).join(",");
const out = {
  taken_at: new Date().toISOString(),
  policies: await q(`select tablename, policyname, permissive, cmd, roles::text, qual, with_check from pg_policies where schemaname='public' and tablename in (${list}) order by 1, 2`),
  table_grants: await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in (${list}) and grantee in ('anon','authenticated') order by 1, 2, 3`),
  offers_column_grants: await q(`select grantee, column_name, privilege_type from information_schema.column_privileges where table_schema='public' and table_name='offers' and grantee in ('anon','authenticated') and privilege_type='UPDATE' order by 1, 2`),
  brands_policy: await q(`select policyname, cmd, qual, with_check from pg_policies where schemaname='storage' and policyname='brands_write'`),
  functions: await q(`select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('staff_can','touch_attendance')`),
};
writeFileSync(`${dir}/0073-before.json`, JSON.stringify(out, null, 2));
console.log(`backup: ${out.policies.length} policies, ${out.table_grants.length} table grants, ${out.offers_column_grants.length} offers column grants, functions present: ${out.functions.map((f) => f.proname).join(",") || "none"}`);
await c.end();
