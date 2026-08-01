-- App Travluin — the database learns who works here.
--
-- Every policy in this schema said `to authenticated using (true)`: 50 of them.
-- That is fine while the only accounts are staff accounts, and it stops being
-- fine the moment anyone else gets a login. Partner companies are about to get
-- one, so before that door opens:
--
--   * `is_staff()` answers whether the current session belongs to an ACTIVE
--     employee. A partner has no employees row, so they fail every staff policy
--     without a single policy having to know that partners exist.
--   * The eight anon policies go. They existed for the public client link, which
--     reads through the SERVICE client now — so the only thing they were still
--     providing was the ability to list every offer in the company with the
--     anon key that ships in the browser bundle. Knowing a serial and being able
--     to enumerate all of them are different permissions.
--
-- This does NOT fix the other half of the known issue: an employee can still
-- read cost and profit, and still write to `roles`. Narrowing that needs
-- per-permission policies and is its own piece of work. This migration keeps
-- staff exactly where they were and puts everyone else outside.

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employees
    where auth_user_id = auth.uid()
      and coalesce(status, 'Active') = 'Active'
  );
$$;

comment on function public.is_staff() is
  'True when the current session is an active employee. The gate every staff RLS policy sits behind.';

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated, anon;

-- ---------------------------------------------------------------- staff ----
-- ALTER rather than drop/create: the command and the roles stay exactly as they
-- were, and only the predicate changes. A policy that is already scoped to
-- something narrower than `true` is left alone.
do $$
declare p record;
begin
  for p in
    select tablename, policyname, with_check
    from pg_policies
    where schemaname = 'public'
      and 'authenticated' = any(roles)
      and qual = 'true'
  loop
    if p.with_check is null then
      execute format('alter policy %I on public.%I using (public.is_staff())', p.policyname, p.tablename);
    else
      execute format(
        'alter policy %I on public.%I using (public.is_staff()) with check (public.is_staff())',
        p.policyname, p.tablename
      );
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------- anon ----
-- The client link and its PDF both read through getPublishedClientOffer, which
-- now uses the service role — the same decision resolveDocBrand already made,
-- and for the same reason: a page with no session must not need the whole table
-- opened to reach one row.
drop policy if exists public_read on public.offers;
drop policy if exists public_read_client on public.offer_renders;
drop policy if exists public_read on public.offer_cities;
drop policy if exists public_read on public.offer_flights;
drop policy if exists public_read on public.offer_services;
drop policy if exists public_read on public.offer_terms;
drop policy if exists public_read on public.city_climate_notes;
-- airlines stays readable: it is a public reference list of carrier names and
-- logos, carries nothing about us or our clients, and the document draws from it.

notify pgrst, 'reload schema';
