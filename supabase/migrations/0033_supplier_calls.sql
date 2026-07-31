-- App Travluin — the supplier conversation, written down.
--
-- Every request we send a booking API and every answer it gives, kept verbatim.
-- Three reasons, in order of how much they hurt when missing:
--
--   1. A booking is money. When TBO says a stay was confirmed and the guest is
--      turned away at the desk, the only thing that settles it is the exact JSON
--      both sides exchanged, with a timestamp.
--   2. TBO's own certification REQUIRES it: eight request/response pairs, zipped
--      and mailed, before live credentials are issued. This table is that
--      deliverable — produced by the real code path, so it cannot drift from
--      what the system actually sends.
--   3. A Book call that times out is not a failed booking. The spec is explicit:
--      call BookingDetail with the BookingReferenceId 120 seconds later. That
--      recovery is impossible unless the reference we sent was written down
--      BEFORE the call.
--
-- RLS: enabled with NO policy — service role only, like passports (0024) and the
-- credential vault (0017). A request body carries the guest's name, email and
-- phone; a response carries what we PAY. Neither belongs to "any authenticated
-- user", which is what every other policy in this database still means.

create table if not exists public.supplier_calls (
  id uuid primary key default gen_random_uuid(),
  supplier_code text not null,
  -- Search | PreBook | Book | BookingDetail | Cancel | CountryList | …
  method text not null,
  booking_id uuid references public.operation_bookings (id) on delete set null,
  -- our idempotency key, so a call can be traced without joining
  client_reference text,
  request jsonb,
  response jsonb,
  http_status integer,
  -- TBO's own Status.Code, which is NOT the HTTP status: it answers 200 while
  -- saying 401 in the body, and reading only the former reports success.
  status_code integer,
  duration_ms integer,
  ok boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees (id) on delete set null
);

create index if not exists supplier_calls_booking_idx on public.supplier_calls (booking_id, created_at desc);
create index if not exists supplier_calls_method_idx on public.supplier_calls (supplier_code, method, created_at desc);
create index if not exists supplier_calls_reference_idx on public.supplier_calls (client_reference);

alter table public.supplier_calls enable row level security;

-- The two identifiers a machine booking needs and a manual one never had.
-- supplier_booking_code is the exact rate we committed to (TBO's BookingCode,
-- which encodes hotel + room + a session token, and expires); supplier_ref is
-- OUR reference, written before the Book call so a lost answer stays findable.
alter table public.operation_bookings
  add column if not exists supplier_booking_code text,
  add column if not exists supplier_ref text;

comment on column public.operation_bookings.supplier_booking_code is
  'Supplier rate identifier actually committed (TBO BookingCode). Expires — not a permanent key.';
comment on column public.operation_bookings.supplier_ref is
  'Our BookingReferenceId, written BEFORE the Book call so a timed-out booking can be recovered.';

notify pgrst, 'reload schema';
