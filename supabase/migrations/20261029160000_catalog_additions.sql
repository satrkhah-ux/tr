-- «إضافات الموظفين» + payment/bank lines (the owner, 2026-10-29, session G).
--
-- 1) catalog_additions: a hotel, room name, view, country or city an employee
--    added mid-programme. Pending ones show only to their author; the data team
--    (settings.manage) corrects the name and approves it for everyone, or
--    rejects it. Closed table like employee_notifications: RLS on, no policies,
--    grants revoked — only the service role behind the gated server actions
--    (src/lib/data/catalog-additions.ts) reaches it.
-- 2) term_kind gains 'payment' (شروط الدفع) and 'bank' (الحسابات البنكية):
--    the same terms table, global (country_id null) or per country, printed in
--    the client PDF by the offer's country.
--
-- NOT applied by code: the coordinator applies it (backup first).
-- Rollback: scripts/rollback-catalog-additions.sql.
-- Dry run: BEGIN; \i this file; ROLLBACK;

create table if not exists public.catalog_additions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('country', 'city', 'hotel', 'room', 'view')),
  -- what the employee typed, before any suggestion was taken
  typed_text text not null check (char_length(typed_text) between 1 and 200),
  -- what is used: the employee's confirmed text, then the data team's correction
  name text not null check (char_length(name) between 1 and 80),
  -- the catalogue row it made (countries / cities / hotels); null for room / view
  ref_id uuid,
  country_id uuid references public.countries(id) on delete set null,
  city_id uuid references public.cities(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid references public.employees(id) on delete set null,
  reviewed_by uuid references public.employees(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists catalog_additions_status_created
  on public.catalog_additions (status, created_at desc);
create index if not exists catalog_additions_kind_author
  on public.catalog_additions (kind, created_by);

alter table public.catalog_additions enable row level security;
revoke all on public.catalog_additions from anon, authenticated;

-- ADD VALUE is allowed inside a transaction (PG12+); the new values are only
-- USED after commit, by the app.
alter type public.term_kind add value if not exists 'payment';
alter type public.term_kind add value if not exists 'bank';
