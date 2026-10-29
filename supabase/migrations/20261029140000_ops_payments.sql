-- ============================================================================
-- 20261029140000 — operations payments (the owner, 2026-10-29, session E):
--
--   1. operation_payments.method takes Tabby, Tamara and Visa beside the four
--      it had — the one list in src/lib/payments/methods.ts (PAY_METHODS).
--   2. operations.agreed_total — «السعر المعروض المرسل للعميل»: what the
--      client was actually quoted (a payment method's fee, a discount) when it
--      differs from the offer's total. NULL = the offer's total stands, so
--      every existing case reads exactly as before.
--
-- NOT applied by code: the coordinator applies it (backup first) BEFORE
-- deploying branch ops-payments — that code selects agreed_total.
-- Dry run: scripts/dry-run-ops-payments.mjs (one transaction, always rolled back).
-- ============================================================================

-- 1. the method check, found by what it says (0024 named it automatically), dropped and written again
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.operation_payments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%method%'
  loop
    execute format('alter table public.operation_payments drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.operation_payments
  add constraint operation_payments_method_check
    check (method in ('tabby', 'tamara', 'pos', 'card', 'link', 'cash', 'transfer'));

-- 2. the price the client was quoted, when it is not the offer's
alter table public.operations
  add column if not exists agreed_total numeric(12, 2)
    check (agreed_total is null or agreed_total > 0);

comment on column public.operations.agreed_total is
  'The price sent to the client when it differs from offers.total (a payment fee, a discount). NULL = offers.total. Session E, 2026-10-29.';

notify pgrst, 'reload schema';

-- ROLLBACK (manual) — refused while any payment already uses a new method:
--   alter table public.operations drop column if exists agreed_total;
--   alter table public.operation_payments drop constraint if exists operation_payments_method_check;
--   alter table public.operation_payments add constraint operation_payments_method_check
--     check (method in ('transfer', 'cash', 'pos', 'link'));
