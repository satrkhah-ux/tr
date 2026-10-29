-- Rollback of 20261029160000_catalog_additions.sql.
-- The table goes. The two term_kind values cannot be dropped from an enum in
-- Postgres; delete their rows so nothing prints them, and they stay unused.
begin;
drop table if exists public.catalog_additions;
delete from public.terms where kind::text in ('payment', 'bank');
commit;
