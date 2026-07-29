-- App Travluin — «العمليات»: bookings, dispatches and issued documents.
--
-- ONE table for every booking kind (hotel / flight / visa / transport / service).
-- The differences all live in `detail` jsonb; splitting by kind would mean two
-- UIs, two actions and two voucher paths for what is the same object — a thing
-- we asked a supplier for, which either came back with a reference or did not.
--
-- Everything here works MANUALLY today: the agent types the confirmation number
-- read off a supplier email or portal. The supplier-API path (TBO PreBook/Book)
-- writes the SAME columns, so connecting it later changes no schema and no
-- screen. That is deliberate — TBO credentials do not exist yet.
--
-- `client_reference` is UNIQUE and is written BEFORE any supplier call, with
-- status 'in_flight'. It is the double-booking guard, and it is a database
-- constraint rather than application code: a crash mid-call leaves a visible
-- orphan the agent must reconcile, never a silent second booking.
--
-- operation_documents holds issued vouchers. It is NOT a new variant on
-- offer_renders: that table is unique on (offer_id, variant, version) so it can
-- hold ONE voucher per version while an operation has several, its parent is the
-- wrong one, and its anon policy (variant='client') is a security surface not
-- worth re-reasoning about every time a variant is added. A voucher is reached
-- by an unguessable token instead — unlike the sales PDF it cannot be redacted,
-- because it carries guest names and the confirmation number, which is exactly
-- what would let a stranger check in as the client.
-- Idempotent; safe to re-run.

-- ---------- operation_bookings ----------
create table if not exists public.operation_bookings (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations (id) on delete cascade,
  kind text not null check (kind in ('hotel','flight','visa','transport','service')),

  -- WHAT: denormalized so a voucher never has to re-join live data that may
  -- have changed since the booking was made.
  title text not null default '',
  city_name text not null default '',
  start_date date,
  end_date date,
  detail jsonb not null default '{}'::jsonb,

  -- WITH WHOM
  supplier_code text,
  supplier_name text not null default '',
  source text not null default 'manual' check (source in ('manual','api')),

  -- STATE
  status text not null default 'pending'
    check (status in ('pending','prebooked','in_flight','confirmed','failed','cancelled')),
  supplier_status text,                       -- the supplier's OWN word, verbatim

  -- REFERENCES
  client_reference text unique,               -- our idempotency key
  confirmation_number text,
  supplier_booking_id text,
  voucher_ref text,

  -- MONEY (supplier NET, in SAR; the client sell price stays on the offer)
  quoted_net numeric(12, 2),
  prebook_net numeric(12, 2),
  net_charged numeric(12, 2),
  currency text not null default 'SAR',

  -- DEADLINES
  cancellation_policy text,
  cancellation_deadline timestamptz,
  prebook_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,

  created_by uuid references public.employees (id) on delete set null,
  confirmed_by uuid references public.employees (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists operation_bookings_operation_id_idx on public.operation_bookings (operation_id);
create index if not exists operation_bookings_status_idx on public.operation_bookings (status);
create index if not exists operation_bookings_deadline_idx
  on public.operation_bookings (cancellation_deadline) where status = 'confirmed';

alter table public.operation_bookings enable row level security;
drop policy if exists operation_bookings_authenticated_all on public.operation_bookings;
create policy operation_bookings_authenticated_all
  on public.operation_bookings for all to authenticated using (true) with check (true);

-- ---------- operation_dispatches ----------
create table if not exists public.operation_dispatches (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations (id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email','manual')),
  audience text not null check (audience in ('bookings','client','supplier')),
  template text not null default '',
  to_label text not null default '',
  to_address text,
  subject text,
  -- Freely regenerated while 'draft'; the moment it is sent this is an immutable
  -- record of what actually went out — the same philosophy as offer_renders.
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  provider_message_id text,
  error_note text,
  approved_by uuid references public.employees (id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists operation_dispatches_operation_id_idx on public.operation_dispatches (operation_id);

alter table public.operation_dispatches enable row level security;
drop policy if exists operation_dispatches_authenticated_all on public.operation_dispatches;
create policy operation_dispatches_authenticated_all
  on public.operation_dispatches for all to authenticated using (true) with check (true);

-- ---------- operation_documents ----------
create table if not exists public.operation_documents (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations (id) on delete cascade,
  -- null for a document about the whole trip (the itinerary, the summary)
  booking_id uuid references public.operation_bookings (id) on delete cascade,
  kind text not null
    check (kind in ('hotel_voucher','flight_ticket','itinerary','booking_summary')),
  version integer not null default 1,
  -- The document IS this snapshot. Re-rendering later must not pick up data that
  -- changed after the voucher was handed to the traveller.
  snapshot_json jsonb not null default '{}'::jsonb,
  -- The share token IS the gate; the row id is never a URL.
  token text not null unique,
  revoked_at timestamptz,
  issued_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists operation_documents_operation_id_idx on public.operation_documents (operation_id);
create index if not exists operation_documents_token_idx on public.operation_documents (token);

-- authenticated staff only. NO anon policy: the token route reads through the
-- service role and validates the token itself, because RLS cannot see a URL and
-- an anon policy would expose every voucher to anyone holding the anon key.
alter table public.operation_documents enable row level security;
drop policy if exists operation_documents_authenticated_all on public.operation_documents;
create policy operation_documents_authenticated_all
  on public.operation_documents for all to authenticated using (true) with check (true);
