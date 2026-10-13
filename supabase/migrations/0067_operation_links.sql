-- Operations order 11 (suggestions 2 and 3): links for the people outside the
-- system.
--
--  · kind 'supplier' — one booking request: the supplier opens it and confirms
--    it himself (a confirmation number, or the driver and car of a transfer).
--    Tied to the supplier it was minted for: hand the booking to someone else
--    and the link stops answering.
--  · kind 'driver' — one driver's day (his phone, a date): the pick-ups and a
--    «استلمت الضيوف» button per pick-up.
--
-- The token IS the gate, as for /trip and /voucher: 24 random bytes (32
-- base64url characters), read by the app through the service role and refused
-- once expired or revoked. No session reads this table — the staff policy is
-- there in case a grant ever comes back, as for supplier_payments (0063).
-- Additive and idempotent; safe to re-run.

create table if not exists public.operation_links (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('supplier', 'driver')),
  token text not null unique check (length(token) >= 32),
  booking_id uuid references public.operation_bookings (id) on delete cascade,
  supplier_id uuid references public.company_suppliers (id) on delete cascade,
  -- digits only, as wa.me wants them («9665…», «6012…»)
  driver_phone text,
  driver_name text,
  service_date date,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  -- the supplier answered through it
  answered_at timestamptz,
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint operation_links_target check (
    (kind = 'supplier' and booking_id is not null and supplier_id is not null)
    or (kind = 'driver' and driver_phone is not null and service_date is not null)
  )
);

create index if not exists operation_links_booking_idx
  on public.operation_links (booking_id) where booking_id is not null;
create index if not exists operation_links_driver_idx
  on public.operation_links (driver_phone, service_date) where kind = 'driver';

alter table public.operation_links enable row level security;
drop policy if exists operation_links_staff on public.operation_links;
create policy operation_links_staff on public.operation_links
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.operation_links from anon, authenticated;

notify pgrst, 'reload schema';
