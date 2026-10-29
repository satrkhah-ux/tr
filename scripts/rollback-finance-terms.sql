-- Rollback of 20261029160100_finance_terms.sql. The enum value 'instalment'
-- cannot be dropped in Postgres; its rows go so nothing prints them.
begin;
delete from public.terms where kind::text = 'instalment';
alter table public.terms
  drop column if exists due_when,
  drop column if exists due_days,
  drop column if exists due_percent,
  drop column if exists due_amount;
commit;
