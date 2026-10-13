// Backup before 0060–0066 (partner order 9, operations orders 5–11) — read-only.
// The definitions these migrations touch, and a rollback script, to
// data-import/backups/ops-db-2026-10-13/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const dir = "data-import/backups/ops-db-2026-10-13";
mkdirSync(dir, { recursive: true });
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
const tables = ["offers", "operation_travelers", "operations", "operation_payments", "operation_bookings", "company_suppliers", "app_settings"];
const list = tables.map((t) => `'${t}'`).join(",");

const out = {
  taken_at: new Date().toISOString(),
  columns: await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name in (${list}) order by table_name, ordinal_position`),
  constraints: await q(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as d from pg_constraint where conrelid in (${tables.map((t) => `'public.${t}'::regclass`).join(",")})`),
  policies: await q(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname='public' and tablename in (${list})`),
  buckets: await q("select id, public from storage.buckets"),
  app_settings: await q("select * from public.app_settings"),
  booking_assignee_counts: await q("select assignee_kind, count(*)::int from public.operation_bookings group by 1"),
};
writeFileSync(`${dir}/before.json`, JSON.stringify(out, null, 2));

const oldBookingChecks = out.constraints.filter((r) => r.t === "operation_bookings" && r.d.includes("assignee_kind"));
writeFileSync(
  `${dir}/rollback.sql`,
  `-- Undo 0060–0066. Only with the code that reads them NOT deployed.
begin;
drop table if exists public.client_message_templates, public.destination_guides;
drop table if exists public.operation_ratings, public.operation_issues, public.operation_alerts;
alter table public.operations drop column if exists assignee_id, drop column if exists client_info, drop column if exists travelers_seeded_at;
drop table if exists public.supplier_payments;
alter table public.operation_bookings drop constraint if exists operation_bookings_assignee_pairing, drop constraint if exists operation_bookings_assignee_kind_check;
${oldBookingChecks.map((r) => `alter table public.operation_bookings add constraint ${r.conname} ${r.d};`).join("\n")}
alter table public.operation_bookings drop column if exists assignee_supplier_id, drop column if exists request_status, drop column if exists request_sent_at, drop column if exists request_answered_at, drop column if exists supplier_confirmation_path;
alter table public.company_suppliers drop column if exists whatsapp, drop column if exists request_lang;
delete from public.app_settings where key = 'supplier_reply_hours';
drop table if exists public.operation_installments;
alter table public.operation_payments drop column if exists receipt_no, drop column if exists receipt_token, drop column if exists proof_path, drop column if exists updated_at;
alter table public.operation_travelers drop column if exists birth_date, drop column if exists age, drop column if exists nationality, drop column if exists visa_status, drop column if exists visa_file_path;
drop table if exists public.partner_commission_tiers, public.offer_renewals;
alter table public.offers drop column if exists valid_until;
delete from storage.buckets where id in ('visas', 'payment-proofs', 'supplier-docs') and not exists (select 1 from storage.objects o where o.bucket_id = storage.buckets.id);
notify pgrst, 'reload schema';
commit;
`,
);
console.log(`backup: ${out.columns.length} columns, ${out.constraints.length} constraints, ${out.policies.length} policies; old assignee checks: ${oldBookingChecks.map((r) => r.conname).join(", ")}`);
await c.end();
