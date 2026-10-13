// Backup before 0057–0059 (partner registration, ledger, roles) — read-only.
// Writes the rows these migrations touch, the columns as they are, and a
// rollback script, to data-import/backups/partner-db-2026-10-13/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const dir = "data-import/backups/partner-db-2026-10-13";
mkdirSync(dir, { recursive: true });
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;

const out = {
  taken_at: new Date().toISOString(),
  booking_partners: await q("select * from public.booking_partners"),
  partner_users: await q("select * from public.partner_users"),
  offers_partner_rows: await q("select id, serial, partner_company_id, total, currency from public.offers where partner_company_id is not null"),
  columns: await q(
    "select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name in ('booking_partners','partner_users','offers') order by table_name, ordinal_position",
  ),
  constraints: await q(
    "select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as d from pg_constraint where conrelid in ('public.booking_partners'::regclass,'public.partner_users'::regclass,'public.offers'::regclass)",
  ),
  buckets: await q("select id, public from storage.buckets"),
  existing_tables: await q("select table_name from information_schema.tables where table_schema='public' and table_name in ('partner_invoices','partner_payments')"),
};
writeFileSync(`${dir}/before.json`, JSON.stringify(out, null, 2));
writeFileSync(
  `${dir}/rollback.sql`,
  `-- Undo 0057–0059. Run ONLY if the new code is not deployed (it reads these columns).
begin;
alter table public.partner_users drop column if exists role;
drop table if exists public.partner_payments;
drop table if exists public.partner_invoices;
alter table public.booking_partners drop column if exists credit_limit, drop column if exists credit_currency;
alter table public.offers drop column if exists partner_cost;
drop index if exists public.booking_partners_reference_no_key;
alter table public.booking_partners
  drop column if exists commercial_register, drop column if exists tourism_license, drop column if exists vat_number,
  drop column if exists city, drop column if exists country, drop column if exists terms_accepted_at,
  drop column if exists terms_version, drop column if exists reference_no, drop column if exists documents;
-- the bucket: only if empty
delete from storage.buckets where id = 'partner-documents' and not exists (select 1 from storage.objects where bucket_id = 'partner-documents');
notify pgrst, 'reload schema';
commit;
`,
);
console.log(
  `backup: ${out.booking_partners.length} companies, ${out.partner_users.length} logins, ${out.offers_partner_rows.length} partner offers, ${out.columns.length} columns, buckets ${out.buckets.map((b) => b.id).join(",")}; new tables already there: ${out.existing_tables.length}`,
);
await c.end();
