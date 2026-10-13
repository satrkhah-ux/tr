-- App Travluin — the supplier side of an operation (operations order 8).
--
-- «ينفّذه» could name a colleague or a partner agency, never the supplier who
-- actually books the thing: company_suppliers (0049) fed the generator only.
-- This puts the supplier on the booking, writes down the request we sent them
-- and their answer, and keeps what we paid them — so every supplier has a
-- balance, and «صدرت/سُددت» is a payment with an amount, not a switch.
--
-- 1. company_suppliers.whatsapp, .request_lang — where a request goes and the
--    language it is written in (a Malaysian DMC reads English).
-- 2. operation_bookings: assignee 'supplier' + assignee_supplier_id; the
--    request's clock and answer (sent / declined — «confirmed» stays the
--    booking's own status, proven by its confirmation number); the supplier's
--    confirmation file.
-- 3. supplier_payments — money we paid a supplier, or one refunded to us. It IS
--    cost, so it follows 0047: no session reads or writes it; the app does,
--    through the service role, behind pricing.internal. The staff policy is
--    there in case a grant ever comes back.
-- 4. bucket supplier-docs — confirmations and payment receipts. Private with NO
--    policy, like passports (0024): the service role signs a short URL per view.
-- 5. app_settings.supplier_reply_hours — how long a request may go unanswered
--    before it is flagged. 24 by default.
--
-- The new operation_bookings columns are NOT granted to sessions (0047 grants
-- that table by column): a partner reads its own bookings and must not learn
-- whom we buy from. The app reads them through the service role.
-- Additive and idempotent; safe to re-run.

-- ---------- 1. how a supplier is reached ----------
alter table public.company_suppliers
  add column if not exists whatsapp text,
  add column if not exists request_lang text not null default 'ar' check (request_lang in ('ar', 'en'));

-- ---------- 2. the supplier on the booking, the request, the answer ----------
alter table public.operation_bookings
  -- restrict: a supplier we owe money to cannot vanish from under its bookings
  add column if not exists assignee_supplier_id uuid references public.company_suppliers (id) on delete restrict,
  add column if not exists request_status text check (request_status in ('sent', 'declined')),
  add column if not exists request_sent_at timestamptz,
  add column if not exists request_answered_at timestamptz,
  -- object path in the private supplier-docs bucket — never a URL
  add column if not exists supplier_confirmation_path text;

-- 'supplier' joins the assignee kinds. Both checks that name assignee_kind — the
-- column's own (auto-named in 0027) and the pairing — are found by what they
-- say rather than by a guessed name, dropped, and written again; a re-run drops
-- and re-adds these same two.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.operation_bookings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%assignee_kind%'
  loop
    execute format('alter table public.operation_bookings drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.operation_bookings
  add constraint operation_bookings_assignee_kind_check
    check (assignee_kind in ('ops', 'employee', 'partner', 'supplier')),
  add constraint operation_bookings_assignee_pairing check (
    (assignee_kind = 'ops'
      and assignee_employee_id is null and assignee_partner_id is null and assignee_supplier_id is null)
    or (assignee_kind = 'employee'
      and assignee_employee_id is not null and assignee_partner_id is null and assignee_supplier_id is null)
    or (assignee_kind = 'partner'
      and assignee_partner_id is not null and assignee_employee_id is null and assignee_supplier_id is null)
    or (assignee_kind = 'supplier'
      and assignee_supplier_id is not null and assignee_employee_id is null and assignee_partner_id is null)
  );

create index if not exists operation_bookings_assignee_supplier_idx
  on public.operation_bookings (assignee_supplier_id) where assignee_supplier_id is not null;

-- ---------- 3. what we paid them ----------
create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.company_suppliers (id) on delete restrict,
  -- the case and the booking it settled; kept when either is deleted — money paid stays paid
  operation_id uuid references public.operations (id) on delete set null,
  booking_id uuid references public.operation_bookings (id) on delete set null,
  -- 'refund': the supplier sent money back (a cancellation) — it lowers what we paid
  kind text not null default 'payment' check (kind in ('payment', 'refund')),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'SAR',
  -- the Riyadh day it was paid, as the agent states it
  paid_on date not null,
  method text not null check (method in ('bank_transfer', 'cash', 'card', 'other')),
  reference text,
  -- object path in the private supplier-docs bucket
  receipt_path text,
  note text,
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists supplier_payments_supplier_idx on public.supplier_payments (supplier_id, paid_on desc);
create index if not exists supplier_payments_operation_idx
  on public.supplier_payments (operation_id) where operation_id is not null;

alter table public.supplier_payments enable row level security;
drop policy if exists supplier_payments_staff on public.supplier_payments;
create policy supplier_payments_staff on public.supplier_payments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.supplier_payments from anon, authenticated;

-- ---------- 4. the supplier's papers ----------
insert into storage.buckets (id, name, public)
values ('supplier-docs', 'supplier-docs', false)
on conflict (id) do nothing;

-- ---------- 5. the reply window ----------
insert into public.app_settings (key, value)
values ('supplier_reply_hours', '24')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
