-- The catalogue, cleaned up — part 1 of 2 (structure only, no data changes).
--
-- 1. `catalog_norm` — the ONE folding of a name, matching src/lib/catalog/norm.ts
--    letter for letter, so the app's «هل تقصد …؟» check and the database's
--    unique indexes (0050) agree on what counts as the same name.
-- 2. `cities.sort_order` — the cities an agent picks most come first
--    (ماليزيا: كوالالمبور، سيلانجور، لنكاوي، بينانج), the rest alphabetically.
-- 3. `company_suppliers` — the agency's own suppliers, imported from the old
--    system: who we book hotels/flights/transfers/services through. Internal:
--    the client never sees which supplier a price came from.

create or replace function public.catalog_norm(txt text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    regexp_replace(
      translate(
        lower(btrim(coalesce(txt, ''))),
        'أإآٱةىًٌٍَُِّْٰـ',
        'ااااهي'
      ),
      '\s+', ' ', 'g'
    ), '');
$$;

comment on function public.catalog_norm(text) is
  'Folds an Arabic/Latin catalogue name for duplicate detection. Keep in step with src/lib/catalog/norm.ts.';

alter table public.cities add column if not exists sort_order integer;

comment on column public.cities.sort_order is
  'Lower comes first in the generator''s city list; NULL = after the ordered ones, alphabetically.';

create table if not exists public.company_suppliers (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  -- what we buy from them, in the words the admin edits: «فنادق، طيران، تنقلات، خدمات»
  categories text not null default '',
  contact_name text,
  mobile text,
  email text,
  status text not null default 'Active',
  created_at timestamptz not null default now()
);

create unique index if not exists company_suppliers_name_uidx
  on public.company_suppliers (public.catalog_norm(arabic_name));

alter table public.company_suppliers enable row level security;

-- Staff only. A partner agency must not learn who we buy from.
drop policy if exists company_suppliers_staff_all on public.company_suppliers;
create policy company_suppliers_staff_all
  on public.company_suppliers
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

notify pgrst, 'reload schema';
