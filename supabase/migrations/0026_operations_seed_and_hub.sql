-- App Travluin — «العمليات»: paid-vs-held bookings, and one link for the client.
--
-- TWO facts a booking has to keep apart, because a traveller's day depends on
-- the difference:
--   • status='confirmed'  — the supplier acknowledged the request
--   • is_paid             — it is actually ticketed / paid for
-- An airline holding a seat is not the same as a ticket, and a voucher printed
-- for the first must say so in large letters. One column cannot express both,
-- and printing "confirmed" over an unpaid hold is how a family is turned away
-- at the counter.
--
-- operations.client_token gives the client ONE link that lists whatever has been
-- issued so far — vouchers, tickets, the itinerary. Documents already carry
-- their own tokens for sharing a single file; this is the folder. Revoking it is
-- one UPDATE and takes effect immediately.
-- Idempotent; safe to re-run.

alter table public.operation_bookings
  add column if not exists is_paid boolean not null default false;

alter table public.operation_bookings
  add column if not exists paid_at timestamptz;

-- Where the row came from: seeded from the offer document, or typed by hand.
-- A seeded row must not be duplicated when the seeding runs again.
alter table public.operation_bookings
  add column if not exists origin text not null default 'manual'
    check (origin in ('manual', 'offer'));

alter table public.operation_bookings
  add column if not exists origin_ref text;

-- One seeded booking per source row, per operation. This is what makes
-- "re-seed" safe to press twice: the second run collides and skips instead of
-- creating a second hotel nobody booked.
create unique index if not exists operation_bookings_origin_key
  on public.operation_bookings (operation_id, origin_ref)
  where origin_ref is not null;

alter table public.operations
  add column if not exists client_token text;

create unique index if not exists operations_client_token_key
  on public.operations (client_token)
  where client_token is not null;

alter table public.operations
  add column if not exists client_token_revoked_at timestamptz;
