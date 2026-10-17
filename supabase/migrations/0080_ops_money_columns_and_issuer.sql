-- ============================================================================
-- 0080 — operations.own: the money columns stay the manager's; the issuer stays put
--
-- 0078 gave operations.own (sales) UPDATE on their own file's operations and
-- operation_bookings rows. RLS chooses rows, not columns, and both tables are
-- session-updatable column by column (operations: every column; bookings: every
-- column — 0047 narrowed only SELECT). So through PostgREST, with their own
-- token, a salesperson could still rewrite what their own case cost, and the
-- profit it shows (operation-money.ts: a booking's cost is net_charged ??
-- quoted_net ?? the priced line its origin_ref names) — steps the app keeps for
-- operations.write (access.ts gateManager, supplier-work.ts setBookingCost).
-- And any staff session could move a colleague's offer to themselves BEFORE it
-- reaches operations (0078 only fixed the issuer after), confirm it, and own
-- the case.
--
--  · operation_bookings_money_locked — a session WITHOUT operations.write
--    (auth.uid() set; the service role and the owner's tools pass) may not
--      UPDATE  quoted_net, prebook_net, net_charged, currency, origin_ref,
--              supplier_confirmation_path;
--      INSERT  a row carrying quoted_net, prebook_net, net_charged, origin_ref or
--              supplier_confirmation_path (else delete-and-re-add, or one new
--              booking at a negative net, forges the profit the same way).
--    Who writes them in the app, and why nothing an own-files holder does breaks:
--      quoted_net      supplier-booking.ts price check (service role); the pull
--                      from the offer (operation-seed.ts — moved to the service
--                      role with this migration); addBooking takes one from no
--                      screen.
--      prebook_net     nothing writes it.
--      net_charged     supplier-work.ts setBookingCost (service; gateManager +
--                      pricing.internal); supplier-booking.ts commit / refresh
--                      (service); «تأكيد الكل» (operation-bookings.ts
--                      writeConfirmation, session) — now taken from the manager
--                      only, the field hidden from anyone else.
--      currency        setBookingCost (service). An INSERT may still name it
--                      (addBooking's 'SAR'): a currency with no net costs nothing.
--      origin_ref      the pull from the offer (operation-seed.ts — service role
--                      now): the priced line whose buy is the booking's cost.
--      supplier_confirmation_path
--                      supplier-work.ts attachSupplierConfirmation (service): a
--                      path in the private supplier-docs bucket, which also holds
--                      the supplier payment receipts — a session must not point
--                      a booking at another file there and have it signed.
--    Still the own-files holder's, written through their session: status,
--    confirmation_number, confirmed_at/_by, supplier_name, cancellation_policy /
--    _deadline (confirm, confirm-all, updateBooking), title, city_name, dates,
--    detail, note (updateBooking, saveRoomDetails, flight-follow.ts), is_paid /
--    paid_at (markBookingPaid — «صدرت/سُددت» is the file's step), cancelled_at
--    (cancelBooking), assignee_* / assigned_* / handoff_note (assignBooking),
--    request_status / _sent_at / _answered_at (sendBookingRequest).
--
--  · operations_money_locked — the same session may not UPDATE operations
--    confirmed_at or travel_start: with offers.total they ARE the client's
--    default payment schedule (payments.ts defaultSchedule: the deposit due on
--    the confirmation day, the balance N days before travel), the month a case's
--    profit is reported in, and its cash-flow date (operation-money.ts) — the
--    schedule is the manager's (operation_installments, operations.write). Only
--    the confirmation (operations.ts recordConfirmation, service role) writes
--    them. An own-files holder's session writes client_status, execution_status,
--    updated_at (setClientStatus / setExecutionStatus), assignee_id, client_info
--    (operation-case.ts) — none locked.
--
--  · offers_owner_locked (0078's, extended) — offers.employee_id is «my file»
--    (owns_offer). A session without operations.write:
--      in operations      — may not change it (0078, unchanged);
--      not yet            — may change it only on ITS OWN offer (hand it on), or
--                           with settings.manage. Not a colleague's, and not an
--                           issuer-less one: those are partner files and offers
--                           made with no employee signed in — claiming one is
--                           the same theft.
--    No app path changes the issuer after issue: insertOffer stamps it on INSERT
--    (untouched here), replaceOffer re-issues by UPDATE without it, the partner
--    portal inserts through the service role, and the generic /offers form does
--    not carry it — actions.ts updateRow now refuses a change from anyone
--    without operations.write, because a total edit sends the whole row through
--    the service role, past this trigger.
--
-- Deploy order: the app first (operation-seed.ts writes through the service
-- role, writeConfirmation and updateRow gate the net / the issuer); then this
-- migration. Idempotent. Dry run: scripts/dryrun-0080.mjs.
-- ============================================================================

-- ---------- operation_bookings: the cost columns ----------
create or replace function public.operation_bookings_money_locked() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  touched boolean;
begin
  if tg_op = 'INSERT' then
    touched := new.quoted_net is not null or new.prebook_net is not null or new.net_charged is not null
            or new.origin_ref is not null or new.supplier_confirmation_path is not null;
  else
    touched := new.quoted_net is distinct from old.quoted_net or new.prebook_net is distinct from old.prebook_net
            or new.net_charged is distinct from old.net_charged or new.currency is distinct from old.currency
            or new.origin_ref is distinct from old.origin_ref
            or new.supplier_confirmation_path is distinct from old.supplier_confirmation_path;
  end if;
  if touched
     and auth.uid() is not null
     and not public.staff_can('operations.write') then
    raise exception 'a booking''s cost columns are operations.write only (0080)'
      using errcode = '42501';
  end if;
  return new;
end $$;
comment on function public.operation_bookings_money_locked() is
  'Refuses a session without operations.write writing operation_bookings quoted_net / prebook_net / net_charged / currency / origin_ref / supplier_confirmation_path — what a case cost is the manager''s (0080).';

drop trigger if exists operation_bookings_money_locked on public.operation_bookings;
create trigger operation_bookings_money_locked
  before insert or update of quoted_net, prebook_net, net_charged, currency, origin_ref, supplier_confirmation_path
  on public.operation_bookings
  for each row execute function public.operation_bookings_money_locked();

-- ---------- operations: the dates the payment schedule is read from ----------
create or replace function public.operations_money_locked() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (new.confirmed_at is distinct from old.confirmed_at or new.travel_start is distinct from old.travel_start)
     and auth.uid() is not null
     and not public.staff_can('operations.write') then
    raise exception 'operations.confirmed_at / travel_start set the client''s payment schedule — operations.write only (0080)'
      using errcode = '42501';
  end if;
  return new;
end $$;
comment on function public.operations_money_locked() is
  'Refuses a session without operations.write changing operations.confirmed_at / travel_start — the default payment schedule and the profit month (0080).';

drop trigger if exists operations_money_locked on public.operations;
create trigger operations_money_locked
  before update of confirmed_at, travel_start on public.operations
  for each row execute function public.operations_money_locked();

-- ---------- offers: the issuer — fixed in operations (0078), yours to hand on before ----------
create or replace function public.offers_owner_locked() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.employee_id is distinct from old.employee_id
     and auth.uid() is not null
     and not public.staff_can('operations.write') then
    if exists (select 1 from public.operations o where o.offer_id = old.id) then
      raise exception 'offers.employee_id is fixed once the file is in operations (0078)'
        using errcode = '42501';
    end if;
    -- owns_offer reads the row as it still is: the issuer before this change
    if not public.staff_can('settings.manage') and not public.owns_offer(old.id) then
      raise exception 'only the issuer or an administrator may change offers.employee_id (0080)'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
comment on function public.offers_owner_locked() is
  'A session without operations.write: never changes offers.employee_id once the offer has an operation (0078); before that, only on its own offer or with settings.manage (0080). The issuer decides operations.own.';

drop trigger if exists offers_owner_locked on public.offers;
create trigger offers_owner_locked
  before update of employee_id on public.offers
  for each row execute function public.offers_owner_locked();

-- ============================================================================
-- ROLLBACK (manual — run as one script; back to 0078: an own-files session may
-- write every booking / operation column RLS lets it reach, and any staff
-- session may move an offer that is not yet in operations):
--
-- drop trigger if exists operation_bookings_money_locked on public.operation_bookings;
-- drop function if exists public.operation_bookings_money_locked();
-- drop trigger if exists operations_money_locked on public.operations;
-- drop function if exists public.operations_money_locked();
-- create or replace function public.offers_owner_locked() returns trigger
--   language plpgsql security definer set search_path = public as $$
-- begin
--   if new.employee_id is distinct from old.employee_id
--      and auth.uid() is not null
--      and not public.staff_can('operations.write')
--      and exists (select 1 from public.operations o where o.offer_id = old.id) then
--     raise exception 'offers.employee_id is fixed once the file is in operations (0078)'
--       using errcode = '42501';
--   end if;
--   return new;
-- end $$;
-- ============================================================================
