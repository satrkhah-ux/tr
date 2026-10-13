// Backup before 0070 (data section tools) — read-only. Any existing definition of
// the functions it creates, and a rollback script, to data-import/backups/data-tools-2026-10-13/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const dir = "data-import/backups/data-tools-2026-10-13";
mkdirSync(dir, { recursive: true });
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
const names = ["catalog_skel", "catalog_row_text", "catalog_search_key", "search_key", "hotel_merge_remap", "merge_hotels"];

const out = {
  taken_at: new Date().toISOString(),
  existing_functions: await q(
    `select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = any ('{${names.join(",")}}')`,
  ),
  hotels_columns: await q(`select column_name, data_type, column_default from information_schema.columns where table_schema='public' and table_name='hotels' order by ordinal_position`),
  indexes: await q(`select indexname, indexdef from pg_indexes where schemaname='public' and tablename in ('offer_hotels','hotel_content_cache')`),
};
writeFileSync(`${dir}/before.json`, JSON.stringify(out, null, 2));
if (out.existing_functions.length) throw new Error(`0070 would replace: ${out.existing_functions.map((f) => f.sig).join(", ")} — review first`);

writeFileSync(
  `${dir}/rollback.sql`,
  `-- Undo 0070. Only with the code that reads them NOT deployed.
begin;
drop function if exists public.merge_hotels(uuid, uuid[]);
drop function if exists public.hotel_merge_remap(jsonb, text, text[], jsonb);
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'search_key' loop
    execute format('drop function %s', f);
  end loop;
end $$;
drop function if exists public.catalog_search_key(text);
drop function if exists public.catalog_row_text(jsonb);
drop function if exists public.catalog_skel(text);
alter table public.hotels drop column if exists status;
${["offer_hotels_hotel_id_idx", "offer_hotels_room_type_id_idx", "hotel_content_cache_internal_hotel_idx"]
  .filter((i) => !out.indexes.some((x) => x.indexname === i))
  .map((i) => `drop index if exists public.${i};`)
  .join("\n")}
notify pgrst, 'reload schema';
commit;
`,
);
console.log(`backup: ${out.hotels_columns.length} hotel columns, ${out.indexes.length} indexes, no existing functions replaced`);
await c.end();
