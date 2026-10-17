-- ============================================================================
-- 0081 — operations.manage_own: a salesperson takes the manager's steps on THEIR files
--
-- The owner (2026-10-17): «اريد كل شخص يدير مبيعاته الى ان نوظف مدير مبيعات
-- يجمع كل العمليات» — until a sales manager is hired, every salesperson fully
-- manages their own files, the steps 0078/0080 kept on operations.write
-- included. The permission key `operations.manage_own` (roles.ts) is that; it
-- only matters beside operations.own. The app's half is
-- src/lib/operations/access.ts gateManagerRows / gateCaseManager; this is the
-- database's, for the writes those actions make through the user's session.
-- Every policy and exception below is
--   staff_can('operations.own') and staff_can('operations.manage_own')
--   and <the row's file is mine> (owns_operation / owns_offer, 0078)
-- and sits BESIDE what was there (permissive policies are OR-ed; the triggers
-- gain one more way through) — operations.write holders keep exactly what they had.
--
-- REVOKE when a sales manager is hired: remove `operations.manage_own` from the
-- «مبيعات» role (the roles screen, or update roles.permission_keys). Nothing
-- else: staff_can() reads the keys live, so every policy here goes inert and
-- 0078/0080 hold as before. This migration may stay applied.
--
--  · operations            UPDATE into «ملغي» (client_status / execution_status
--                          'cancelled') on my case — setClientStatus /
--                          setExecutionStatus, session. 0078's own-update policy
--                          is left as it is; a new one without the cancelled
--                          check stands beside it. The offer must stay mine.
--  · operation_payments    INSERT of any kind on my case (a refund: recordPayment,
--                          session); UPDATE (updatePayment, session); DELETE
--                          (deletePayment, session — the app writes the WHOLE
--                          row to audit_logs before it erases one, and erases
--                          nothing when that write fails; the slip stays in the
--                          bucket). The receipt number and the slip's path are
--                          still written by the service role (unchanged).
--  · operation_installments INSERT / DELETE on my case — saveInstallments
--                          replaces the schedule through the session (delete,
--                          then insert). No UPDATE: the app runs none.
--  · supplier_payments     NOTHING: recordSupplierPayment and setBookingCost
--                          write through the service role after the app's gate
--                          (gateManagerRows + pricing.internal). The suppliers'
--                          accounts across every case stay operations.write.
--  · operation_bookings_money_locked (0080) — the cost columns (quoted_net,
--    prebook_net, net_charged, currency, origin_ref, supplier_confirmation_path)
--    are writable by a manage_own holder on a booking of their own case, on
--    UPDATE (old and new case mine) and INSERT («تأكيد الكل» writes net_charged
--    through the session; addBooking may name quoted_net).
--  · operations_money_locked (0080) — confirmed_at / travel_start likewise on
--    their own case (the client's default schedule is theirs to set now).
--  · offers_owner_locked — UNCHANGED: the issuer of a file in operations stays
--    fixed; it is what «mine» is decided by.
--    Both trigger functions are 0080's bodies verbatim plus that one exception.
--
-- Deploy order: the app first (access.ts gateManagerRows; the case page shows
-- the controls from it), then this migration, then tick the key on «مبيعات».
-- Idempotent. Dry run: scripts/dryrun-0081.mjs (always rolled back).
-- ============================================================================

-- ---------- operations: cancelling my own case ----------
drop policy if exists operations_manage_own_update on public.operations;
create policy operations_manage_own_update on public.operations
  for update to authenticated
  using (public.staff_can('operations.own') and public.staff_can('operations.manage_own') and public.owns_offer(offer_id))
  with check (public.staff_can('operations.own') and public.staff_can('operations.manage_own') and public.owns_offer(offer_id));

-- ---------- operation_payments: refunds, corrections, deletions on my own case ----------
drop policy if exists operation_payments_manage_own_insert on public.operation_payments;
drop policy if exists operation_payments_manage_own_update on public.operation_payments;
drop policy if exists operation_payments_manage_own_delete on public.operation_payments;
create policy operation_payments_manage_own_insert on public.operation_payments
  for insert to authenticated
  with check (public.staff_can('operations.own') and public.staff_can('operations.manage_own') and public.owns_operation(operation_id));
create policy operation_payments_manage_own_update on public.operation_payments
  for update to authenticated
  using (public.staff_can('operations.own') and public.staff_can('operations.manage_own') and public.owns_operation(operation_id))
  with check (public.staff_can('operations.own') and public.staff_can('operations.manage_own') and public.owns_operation(operation_id));
create policy operation_payments_manage_own_delete on public.operation_payments
  for delete to authenticated
  using (public.staff_can('operations.own') and public.staff_can('operations.manage_own') and public.owns_operation(operation_id));

-- ---------- operation_installments: the client's schedule on my own case ----------
drop policy if exists operation_installments_manage_own_insert on public.operation_installments;
drop policy if exists operation_installments_manage_own_delete on public.operation_installments;
create policy operation_installments_manage_own_insert on public.operation_installments
  for insert to authenticated
  with check (public.staff_can('operations.own') and public.staff_can('operations.manage_own') and public.owns_operation(operation_id));
create policy operation_installments_manage_own_delete on public.operation_installments
  for delete to authenticated
  using (public.staff_can('operations.own') and public.staff_can('operations.manage_own') and public.owns_operation(operation_id));

-- ---------- operation_bookings: the cost columns (0080) — and my own case's ----------
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
     and not public.staff_can('operations.write')
     -- 0081: operations.manage_own on a booking of my own case (the case it is in, and was in)
     and not (public.staff_can('operations.own') and public.staff_can('operations.manage_own')
              and public.owns_operation(new.operation_id)
              and (tg_op = 'INSERT' or public.owns_operation(old.operation_id))) then
    raise exception 'a booking''s cost columns are operations.write only (0080)'
      using errcode = '42501';
  end if;
  return new;
end $$;
comment on function public.operation_bookings_money_locked() is
  'Refuses a session without operations.write writing operation_bookings quoted_net / prebook_net / net_charged / currency / origin_ref / supplier_confirmation_path — what a case cost is the manager''s (0080); operations.manage_own on one''s own case passes (0081).';

-- ---------- operations: the dates the payment schedule is read from (0080) — and my own case's ----------
create or replace function public.operations_money_locked() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (new.confirmed_at is distinct from old.confirmed_at or new.travel_start is distinct from old.travel_start)
     and auth.uid() is not null
     and not public.staff_can('operations.write')
     -- 0081: operations.manage_own on my own case (its offer mine before and after)
     and not (public.staff_can('operations.own') and public.staff_can('operations.manage_own')
              and public.owns_offer(old.offer_id) and public.owns_offer(new.offer_id)) then
    raise exception 'operations.confirmed_at / travel_start set the client''s payment schedule — operations.write only (0080)'
      using errcode = '42501';
  end if;
  return new;
end $$;
comment on function public.operations_money_locked() is
  'Refuses a session without operations.write changing operations.confirmed_at / travel_start — the default payment schedule and the profit month (0080); operations.manage_own on one''s own case passes (0081).';

notify pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (manual — run as one script; back to 0080: the manager's steps are
-- operations.write only, whatever the «مبيعات» role holds). Removing the key
-- from «مبيعات» does the same without touching the schema.
--
-- drop policy if exists operations_manage_own_update on public.operations;
-- drop policy if exists operation_payments_manage_own_insert on public.operation_payments;
-- drop policy if exists operation_payments_manage_own_update on public.operation_payments;
-- drop policy if exists operation_payments_manage_own_delete on public.operation_payments;
-- drop policy if exists operation_installments_manage_own_insert on public.operation_installments;
-- drop policy if exists operation_installments_manage_own_delete on public.operation_installments;
-- create or replace function public.operation_bookings_money_locked() returns trigger
--   language plpgsql security definer set search_path = public as $$
-- declare
--   touched boolean;
-- begin
--   if tg_op = 'INSERT' then
--     touched := new.quoted_net is not null or new.prebook_net is not null or new.net_charged is not null
--             or new.origin_ref is not null or new.supplier_confirmation_path is not null;
--   else
--     touched := new.quoted_net is distinct from old.quoted_net or new.prebook_net is distinct from old.prebook_net
--             or new.net_charged is distinct from old.net_charged or new.currency is distinct from old.currency
--             or new.origin_ref is distinct from old.origin_ref
--             or new.supplier_confirmation_path is distinct from old.supplier_confirmation_path;
--   end if;
--   if touched
--      and auth.uid() is not null
--      and not public.staff_can('operations.write') then
--     raise exception 'a booking''s cost columns are operations.write only (0080)'
--       using errcode = '42501';
--   end if;
--   return new;
-- end $$;
-- comment on function public.operation_bookings_money_locked() is
--   'Refuses a session without operations.write writing operation_bookings quoted_net / prebook_net / net_charged / currency / origin_ref / supplier_confirmation_path — what a case cost is the manager''s (0080).';
-- create or replace function public.operations_money_locked() returns trigger
--   language plpgsql security definer set search_path = public as $$
-- begin
--   if (new.confirmed_at is distinct from old.confirmed_at or new.travel_start is distinct from old.travel_start)
--      and auth.uid() is not null
--      and not public.staff_can('operations.write') then
--     raise exception 'operations.confirmed_at / travel_start set the client''s payment schedule — operations.write only (0080)'
--       using errcode = '42501';
--   end if;
--   return new;
-- end $$;
-- comment on function public.operations_money_locked() is
--   'Refuses a session without operations.write changing operations.confirmed_at / travel_start — the default payment schedule and the profit month (0080).';
-- notify pgrst, 'reload schema';
-- ============================================================================
