-- ============================================================================
-- 0085 — «معالج الحجوزات»: a manager's exception to «جاهز للسفر» is the manager's
--
-- operations.ready_exceptions (0084) lets a case be «جاهز للسفر» before the
-- client paid in full. The app sets it only through gateCaseManager
-- (src/lib/data/operation-wizard.ts setPaymentException) — operations.write, or
-- operations.manage_own on one's own file. But 0078 lets an operations.own
-- session UPDATE its own case row, so without this a salesperson WITHOUT
-- manage_own could write the exception straight through PostgREST. This is the
-- database's half, the same rule and the same trigger as the payment schedule's
-- dates (0080 operations_money_locked, widened by 0081): the column joins it.
--
-- NOT APPLIED (written 2026-10-17 with the wizard). Idempotent.
-- ============================================================================

create or replace function public.operations_money_locked() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (new.confirmed_at is distinct from old.confirmed_at
      or new.travel_start is distinct from old.travel_start
      or new.ready_exceptions is distinct from old.ready_exceptions)
     and auth.uid() is not null
     and not public.staff_can('operations.write')
     -- 0081: operations.manage_own on my own case (its offer mine before and after)
     and not (public.staff_can('operations.own') and public.staff_can('operations.manage_own')
              and public.owns_offer(old.offer_id) and public.owns_offer(new.offer_id)) then
    raise exception 'operations.confirmed_at / travel_start / ready_exceptions are the manager''s — operations.write, or manage_own on one''s own case (0080/0081/0085)'
      using errcode = '42501';
  end if;
  return new;
end $$;
comment on function public.operations_money_locked() is
  'Refuses a session without operations.write changing operations.confirmed_at / travel_start (the payment schedule, 0080) or ready_exceptions (a manager''s exception to «جاهز للسفر», 0085); operations.manage_own on one''s own case passes (0081).';

drop trigger if exists operations_money_locked on public.operations;
create trigger operations_money_locked
  before update of confirmed_at, travel_start, ready_exceptions on public.operations
  for each row execute function public.operations_money_locked();

notify pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (manual — back to 0081): re-run the operations_money_locked function
-- from 0081 and recreate the trigger as 0080 did:
--   drop trigger if exists operations_money_locked on public.operations;
--   create trigger operations_money_locked
--     before update of confirmed_at, travel_start on public.operations
--     for each row execute function public.operations_money_locked();
-- ============================================================================
