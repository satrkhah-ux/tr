-- App Travluin — partner companies get accounts, and a lane of their own.
--
-- Registration does NOT write through an anon policy: the public form posts to a
-- server action that uses the service role. Opening `booking_partners` to anon
-- inserts would let anyone create rows, and worse, set their own brand colours
-- and price adjustment before anyone looked at them. A registration is a request
-- to be considered, so the row lands as `pending` and nothing else happens until
-- an employee approves it.
--
-- The partner policies below are the ONLY way a partner session reaches data.
-- Everything else is already closed by is_staff() (0034), so anything not
-- granted here is denied by default rather than by remembering to deny it.

-- ------------------------------------------------------- booking_partners ----
alter table public.booking_partners
  add column if not exists status text not null default 'approved',
  add column if not exists slug text,
  -- Which direction the percentage moves, decided per company by us:
  --   markup     → the partner pays our sell PLUS this much
  --   commission → the partner pays our sell MINUS this much
  add column if not exists price_adjust_kind text not null default 'markup',
  add column if not exists price_adjust_pct numeric(6, 2) not null default 0,
  add column if not exists approved_by uuid references public.employees (id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists registration_note text,
  add column if not exists contact_email text;

-- Rows that existed before this migration were created BY staff, so they are
-- approved by definition — only new registrations start pending.
update public.booking_partners set status = 'approved' where status is null;

alter table public.booking_partners
  drop constraint if exists booking_partners_status_check,
  add constraint booking_partners_status_check
    check (status in ('pending', 'approved', 'rejected', 'suspended'));

alter table public.booking_partners
  drop constraint if exists booking_partners_adjust_kind_check,
  add constraint booking_partners_adjust_kind_check
    check (price_adjust_kind in ('markup', 'commission'));

-- A negative percentage would flip the direction silently, which is the one
-- mistake nobody would notice until an invoice.
alter table public.booking_partners
  drop constraint if exists booking_partners_adjust_pct_check,
  add constraint booking_partners_adjust_pct_check
    check (price_adjust_pct >= 0 and price_adjust_pct <= 100);

create unique index if not exists booking_partners_slug_key on public.booking_partners (slug) where slug is not null;

-- ----------------------------------------------------------- partner_users ----
-- No password column: authentication stays in Supabase Auth, and we never
-- generate, transmit or store one. An approved company gets a set-your-password
-- link and chooses it themselves.
create table if not exists public.partner_users (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.booking_partners (id) on delete cascade,
  auth_user_id uuid unique,
  email text not null,
  name text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  created_by uuid references public.employees (id) on delete set null
);

create unique index if not exists partner_users_email_key on public.partner_users (lower(email));
create index if not exists partner_users_partner_idx on public.partner_users (partner_id);

alter table public.partner_users enable row level security;

-- Drafts need to say whose they are, the same way offers already do.
alter table public.offer_drafts
  add column if not exists partner_company_id uuid references public.booking_partners (id) on delete set null;
create index if not exists offer_drafts_partner_idx on public.offer_drafts (partner_company_id);

-- ------------------------------------------------------------- the session ----
/**
 * The partner company the current session belongs to, or null.
 *
 * Stable and security-definer so a policy can call it without the caller needing
 * to read partner_users — which they cannot, by design.
 */
create or replace function public.current_partner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pu.partner_id
  from public.partner_users pu
  join public.booking_partners bp on bp.id = pu.partner_id
  where pu.auth_user_id = auth.uid()
    and pu.status = 'active'
    and bp.status = 'approved'
  limit 1;
$$;

comment on function public.current_partner_id() is
  'The approved partner company behind this session, or null. Every partner policy hangs off it.';

revoke all on function public.current_partner_id() from public;
grant execute on function public.current_partner_id() to authenticated;

-- ---------------------------------------------------------- staff policies ----
create policy partner_users_staff on public.partner_users
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- --------------------------------------------------------- partner policies ----
-- Read your own account row, and your own company. Nothing else about either.
create policy partner_users_self on public.partner_users
  for select to authenticated using (auth_user_id = auth.uid());

create policy booking_partners_self on public.booking_partners
  for select to authenticated using (id = public.current_partner_id());

-- Your own drafts: yours to create, read and edit.
create policy offer_drafts_partner on public.offer_drafts
  for all to authenticated
  using (partner_company_id is not null and partner_company_id = public.current_partner_id())
  with check (partner_company_id is not null and partner_company_id = public.current_partner_id());

-- Your own offers: readable, NOT writable. An issued offer is a record of what
-- we sent; edits go through the generator and the producer, never a direct write.
create policy offers_partner_read on public.offers
  for select to authenticated
  using (partner_company_id is not null and partner_company_id = public.current_partner_id());

-- The progress of your own files. Read-only for the same reason the ops screen
-- requires operations.book: a booking is money, and it is our press.
create policy operation_bookings_partner_read on public.operation_bookings
  for select to authenticated
  using (
    exists (
      select 1
      from public.operations o
      join public.offers f on f.id = o.offer_id
      where o.id = operation_bookings.operation_id
        and f.partner_company_id is not null
        and f.partner_company_id = public.current_partner_id()
    )
  );

-- The parts of an offer the partner's own document is built from.
create policy offer_hotels_partner_read on public.offer_hotels
  for select to authenticated
  using (
    exists (
      select 1 from public.offers f
      where f.id = offer_hotels.offer_id
        and f.partner_company_id is not null
        and f.partner_company_id = public.current_partner_id()
    )
  );

notify pgrst, 'reload schema';
