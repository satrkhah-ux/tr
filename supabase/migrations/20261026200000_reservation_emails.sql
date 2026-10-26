-- ============================================================================
-- 20261026200000 — reservation_emails: supplier replies on the shared mailbox
-- (the owner, 2026-10-26: reservations@traveliun.com, cPanel/Namecheap IMAP).
--
-- DO NOT APPLY TO LIVE until the owner's explicit yes via the coordinator —
-- the mailbox itself does not exist yet; everything runs on fixtures.
--
-- One row per message the reader pulls: what it said (kind, refs) and where it
-- landed (operation/booking, matched_by) — or status 'new' for «بريد بلا ملف»,
-- where a human links or dismisses it. unique (message_uid) is the dedupe: the
-- reader inserts on-conflict-do-nothing and only a NEW row triggers the issue
-- and the notice.
--
-- Closed table like the rest of ours (as employee_notifications): RLS on with
-- NO policies + default grants revoked from anon AND authenticated. A supplier's
-- email carries guest names and confirmation numbers across every case, so no
-- browser session reaches it — only the service role, behind the reader (cron,
-- secret-gated) and reservation-mail-actions.ts (operations.write).
-- ============================================================================

create table if not exists public.reservation_emails (
  id uuid primary key default gen_random_uuid(),
  message_uid text not null,
  message_id text,
  received_at timestamptz,
  from_address text,
  subject text,
  -- the first ~2000 chars only: enough to read the reply, not an archive
  body_excerpt text,
  kind text check (kind in ('confirmation', 'hotel_change', 'no_availability', 'cancellation', 'other')),
  -- what classify.ts extracted: numbers, hotel/guest names, dates
  refs jsonb,
  operation_id uuid references public.operations (id) on delete set null,
  booking_id uuid references public.operation_bookings (id) on delete set null,
  matched_by text check (matched_by in ('number', 'name_dates', 'manual')),
  status text not null default 'new' check (status in ('new', 'linked', 'dismissed')),
  created_at timestamptz default now(),
  unique (message_uid)
);
create index if not exists reservation_emails_status_idx on public.reservation_emails (status, created_at desc);

alter table public.reservation_emails enable row level security;
revoke all on public.reservation_emails from anon, authenticated;
-- an earlier draft opened it to every staff session — never applied, dropped here so a re-run is clean
drop policy if exists reservation_emails_staff_all on public.reservation_emails;

comment on table public.reservation_emails is
  'Supplier replies read from reservations@traveliun.com (IMAP): classified, ref-extracted, linked to a booking or left for «بريد بلا ملف».';

-- «الربط الخارجي»: the mailbox is an external connection — registered with its
-- check (lib/developer/checks.ts mail_reservations); env NAMES only, never values.
insert into public.integrations (name, kind, used_by, secret_ref, account, check_key, notes)
values (
  'بريد الحجوزات reservations@',
  'api',
  'قارئ بريد الحجوزات (src/lib/reservations-mail) و/api/ops/mail',
  'RESERVATIONS_IMAP_HOST / RESERVATIONS_IMAP_USER / RESERVATIONS_IMAP_PASSWORD',
  'cPanel traveliun.com',
  'mail_reservations',
  'صندوق reservations@traveliun.com — ردود الموردين (تأكيد/إلغاء/عدم توفر/تغيير فندق)'
)
on conflict (name) do nothing;

notify pgrst, 'reload schema';

-- ROLLBACK (manual) — the table is closed, so nothing outside it depends on a policy:
--   delete from public.integrations where name = 'بريد الحجوزات reservations@';
--   drop table if exists public.reservation_emails;
--
-- DRY RUN: begin; \i supabase/migrations/20261026200000_reservation_emails.sql
--   then: select has_table_privilege('authenticated', 'public.reservation_emails', 'select');  -- must be false
--         select count(*) from pg_policies where tablename = 'reservation_emails';               -- must be 0
--   rollback;
