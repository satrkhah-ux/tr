-- ============================================================================
-- 0084 — «معالج الحجوزات»: the columns the six-step case wizard reads and writes
--
-- The owner's order (2026-10-17, relayed by the evaluation session): a case is
-- worked in six steps — passports, flight tickets, hotels, «المواصلات» by city,
-- the payment, the documents — uploading the file first and typing only what no
-- file holds; a step can wait on someone until a date; and the client's trip
-- link carries a booking number of OURS for every service from the day the
-- client confirms.
--
--  · operation_bookings.company_ref — that number: <serial>-<H|F|T|V|S><n>
--    (AD-2-7287-20261012-H1), set by the database on insert, never typed, unique.
--    It is what the client sees for a hotel until the hotel's own confirmation
--    number arrives. client_reference stays what it is (the supplier API's
--    idempotency key, TRV-<uuid>).
--  · operation_bookings.pnr / ticket_numbers / flight_legs / baggage — a flight
--    booking's ticket, read from the uploaded ticket: the record locator, one
--    ticket number per passenger, the legs as [{flight_no, from, to, departs_at,
--    arrives_at}] (ISO with offset — the drivers' pickup times are computed from
--    these), the allowance as printed.
--  · operations.waits — «ينتظر» per wizard step: {"<step>": {"from":
--    "airline|supplier|agent|client", "until": "YYYY-MM-DD", "note", "at", "by"}}.
--    The follow-up list («قائمة متابعتك اليوم») reads it.
--  · operations.ready_exceptions — a manager's exception to a readiness rule
--    before «جاهز للسفر» (today: {"payment": {"by", "at", "note"}}).
--
-- operation_bookings is SELECT-granted column by column (0047 withholds the
-- nets), so the new columns are granted to sessions explicitly; INSERT/UPDATE
-- are table-level grants already. RLS is unchanged (0078/0080/0081 apply).
-- Idempotent.
-- ============================================================================

alter table public.operation_bookings
  add column if not exists company_ref text,
  add column if not exists pnr text,
  add column if not exists ticket_numbers text[] not null default '{}',
  add column if not exists flight_legs jsonb not null default '[]'::jsonb,
  add column if not exists baggage text;

grant select (company_ref, pnr, ticket_numbers, flight_legs, baggage) on public.operation_bookings to authenticated;

alter table public.operations
  add column if not exists waits jsonb not null default '{}'::jsonb,
  add column if not exists ready_exceptions jsonb not null default '{}'::jsonb;

-- ---------- company_ref: the letter per kind, the next number in the case ----------
create or replace function public.booking_ref_letter(kind text) returns text
  language sql immutable as $$
  select case kind when 'hotel' then 'H' when 'flight' then 'F' when 'transport' then 'T' when 'visa' then 'V' else 'S' end;
$$;

create or replace function public.operation_bookings_company_ref() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  serial text;
  letter text := public.booking_ref_letter(new.kind);
  n int;
begin
  if new.company_ref is not null then
    return new;
  end if;
  select f.serial into serial
    from public.operations o join public.offers f on f.id = o.offer_id
   where o.id = new.operation_id;
  select coalesce(max(nullif(substring(b.company_ref from '-' || letter || '([0-9]+)$'), '')::int), 0) + 1 into n
    from public.operation_bookings b
   where b.operation_id = new.operation_id and b.company_ref like '%-' || letter || '%';
  new.company_ref := coalesce(serial, 'TRV') || '-' || letter || n;
  return new;
end $$;
comment on function public.operation_bookings_company_ref() is
  'Sets operation_bookings.company_ref — <serial>-<H|F|T|V|S><n>, our booking number the client sees per service (0084).';

drop trigger if exists operation_bookings_company_ref on public.operation_bookings;
create trigger operation_bookings_company_ref
  before insert on public.operation_bookings
  for each row execute function public.operation_bookings_company_ref();

-- the bookings already there, numbered in date order within their case and kind
with numbered as (
  select b.id,
         coalesce(f.serial, 'TRV') || '-' || public.booking_ref_letter(b.kind)
           || row_number() over (partition by b.operation_id, public.booking_ref_letter(b.kind)
                                 order by b.start_date nulls last, b.created_at, b.id) as ref
    from public.operation_bookings b
    join public.operations o on o.id = b.operation_id
    left join public.offers f on f.id = o.offer_id
   where b.company_ref is null
)
update public.operation_bookings b set company_ref = numbered.ref from numbered where numbered.id = b.id;

create unique index if not exists operation_bookings_company_ref_key
  on public.operation_bookings (company_ref) where company_ref is not null;

notify pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (manual):
-- drop trigger if exists operation_bookings_company_ref on public.operation_bookings;
-- drop function if exists public.operation_bookings_company_ref();
-- drop function if exists public.booking_ref_letter(text);
-- drop index if exists public.operation_bookings_company_ref_key;
-- alter table public.operation_bookings drop column if exists company_ref, drop column if exists pnr,
--   drop column if exists ticket_numbers, drop column if exists flight_legs, drop column if exists baggage;
-- alter table public.operations drop column if exists waits, drop column if exists ready_exceptions;
-- notify pgrst, 'reload schema';
-- ============================================================================
