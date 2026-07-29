-- App Travluin — «العمليات» (Operations): the execution hub after a client confirms.
--
-- An offer becomes an OPERATION the moment the client confirms it. In v1 the AGENT
-- records that, because the client tells them by phone or WhatsApp — there is no
-- client-facing confirm button, and deliberately no token column on `offers`:
-- offers carries `public_read ... to anon using (true)` (0001), so a token stored
-- there would be readable by anyone and would let a stranger confirm every offer.
-- When the client button is built, its token belongs in its own service-role table.
--
-- From confirmation onward TWO INDEPENDENT tracks run in parallel and are
-- deliberately NOT collapsed into one column:
--   • client_status    — the commercial relationship (confirmed → paid → completed)
--   • execution_status — the fulfilment work (bookings → vouchers → travelled)
-- A client can pay in full while the hotel is still unconfirmed; one column cannot
-- say that. Both are text + check so adding a state stays an ordinary migration
-- rather than `alter type ... add value`, which is not re-runnable. The checks only
-- guarantee a KNOWN value; which moves are LEGAL is enforced in exactly one place,
-- src/lib/operations/state.ts.
--
-- offers.pipeline_stage is untouched here: it stays the kanban's column and is
-- rewritten by the ops action as a coarse projection of execution_status.
--
-- operation_travelers holds PASSPORT data, so it is the second table in this schema
-- (after hotel_suppliers, 0017) with RLS ENABLED and NO POLICY: neither anon nor
-- authenticated reach it through PostgREST. The service-role client behind the
-- `operations.passport` gate is the only path — same for the private `passports`
-- storage bucket, whose policies could only match on bucket_id (see repackage_rw,
-- 0018) and would therefore hand every signed-in user every scan.
-- Idempotent; safe to re-run.

-- ---------- operations ----------
create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references public.offers (id) on delete cascade,
  -- The frozen INTERNAL render the ops team works against. offer_renders is
  -- append-only, so this is an immutable snapshot WITHOUT copying the document.
  -- Null when the offer was never published — the UI then reads the live offer.
  render_id uuid references public.offer_renders (id) on delete set null,
  client_status text not null default 'confirmed'
    check (client_status in ('awaiting_reply','confirmed','paid_partial','paid_full','completed','cancelled')),
  execution_status text not null default 'pending_bookings'
    check (execution_status in ('pending_bookings','flights_booked','hotels_booked','transfers_booked','vouchers_issued','ready_to_travel','travelled','cancelled')),
  -- DERIVED at confirm time from the offer document (arrival date / last check-out).
  -- Stored because neither is a column on offers, and the operations board sorts
  -- and filters on them on every render.
  travel_start date,
  travel_end date,
  confirm_channel text check (confirm_channel in ('phone','whatsapp','office','other')),
  confirmed_by uuid references public.employees (id) on delete set null,
  confirmed_at timestamptz not null default now(),
  note text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists operations_client_status_idx on public.operations (client_status);
create index if not exists operations_execution_status_idx on public.operations (execution_status);
create index if not exists operations_travel_start_idx on public.operations (travel_start);

alter table public.operations enable row level security;
drop policy if exists operations_authenticated_all on public.operations;
create policy operations_authenticated_all
  on public.operations
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------- operation_travelers (LOCKED — passport data) ----------
create table if not exists public.operation_travelers (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations (id) on delete cascade,
  traveler_kind text not null default 'adult'
    check (traveler_kind in ('adult','child','infant')),
  sort int not null default 0,
  -- The working name staff use in lists, as written on the offer. The PASSPORT
  -- name/number/nationality live encrypted in passport_encrypted, never here.
  display_name text not null default '',
  -- AES-256-GCM blob of {full_name, number, nationality} — src/lib/crypto/secrets.ts.
  passport_encrypted text,
  -- CLEAR ON PURPOSE. The «جواز على وشك الانتهاء» signal has to be a WHERE clause;
  -- encrypting it would force decrypting every row in the table to find one. A date
  -- carrying no name and no number identifies nobody.
  passport_expiry date,
  -- Object path in the private `passports` bucket — never a URL, never public.
  passport_image_path text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists operation_travelers_operation_id_idx
  on public.operation_travelers (operation_id);
create index if not exists operation_travelers_passport_expiry_idx
  on public.operation_travelers (passport_expiry);

-- RLS ON, NO POLICY — the 0017 pattern. The drop re-locks the table if a permissive
-- policy was ever added by hand.
alter table public.operation_travelers enable row level security;
drop policy if exists operation_travelers_authenticated_all on public.operation_travelers;

-- ---------- operation_payments ----------
create table if not exists public.operation_payments (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations (id) on delete cascade,
  -- Always POSITIVE. A refund is kind='refund' and is subtracted when totalling,
  -- so the sign lives in one place instead of being a property of every row.
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'SAR',
  kind text not null default 'deposit'
    check (kind in ('deposit','installment','final','refund')),
  method text check (method in ('transfer','cash','pos','link')),
  reference text,
  paid_at date not null default current_date,
  recorded_by uuid references public.employees (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists operation_payments_operation_id_idx
  on public.operation_payments (operation_id);

alter table public.operation_payments enable row level security;
drop policy if exists operation_payments_authenticated_all on public.operation_payments;
create policy operation_payments_authenticated_all
  on public.operation_payments
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------- private storage bucket for passport scans ----------
insert into storage.buckets (id, name, public)
values ('passports', 'passports', false)
on conflict (id) do nothing;

-- NO policy, deliberately. A storage policy here could only test bucket_id (see
-- repackage_rw, 0018), which grants every signed-in user every scan. With no policy
-- the bucket is unreachable by anon and authenticated; the service role signs a
-- 5-minute URL per view, gated on `operations.passport` and written to audit_logs.
drop policy if exists passports_rw on storage.objects;
