-- ============================================================================
-- 20261029140300 — «ادفع الآن» (the owner, 2026-10-29, session E):
--
--   The client PDF and the client page carry a button to OUR stable page
--   /pay/<serial>; it makes (or reuses) the MyFatoorah invoice for the offer's
--   current total and keeps it in payment_links, so the 10-minute job records
--   it. A client may pay BEFORE the file is confirmed, when no operation exists
--   yet — so a link now belongs to the OFFER, and to its case once there is one:
--
--   1. payment_links.offer_id (backfilled from the case), operation_id nullable.
--   2. paid_amount / paid_on: a link paid before the case keeps what was paid;
--      confirming the file (recordConfirmation) — or the next 10-minute run —
--      carries it into operation_payments (provider_ref unique: once).
--
-- NOT applied by code: the coordinator applies it (backup first) BEFORE
-- deploying branch pay-now. Dry run: scripts/dry-run-pay-now.mjs.
-- ============================================================================

alter table public.payment_links
  add column if not exists offer_id uuid references public.offers (id) on delete cascade;

update public.payment_links l
   set offer_id = o.offer_id
  from public.operations o
 where o.id = l.operation_id
   and l.offer_id is null;

alter table public.payment_links alter column offer_id set not null;
alter table public.payment_links alter column operation_id drop not null;

alter table public.payment_links
  add column if not exists paid_amount numeric(12, 2),
  add column if not exists paid_on date;

create index if not exists payment_links_offer_idx on public.payment_links (offer_id, created_at desc);
-- the paid links still waiting for their case
create index if not exists payment_links_held_idx on public.payment_links (offer_id) where status = 'paid' and payment_id is null;

comment on column public.payment_links.offer_id is
  'The offer the link charges — always set; operation_id only once the file has a case.';
comment on column public.payment_links.paid_amount is
  'What the gateway says was paid. A link paid before the case exists stays here (payment_id null) until the case is confirmed.';

-- «الربط الخارجي»: the public page the PDF button opens
update public.integrations
   set used_by = 'روابط السداد في العمليات وبيسك، وزر «ادفع الآن» في PDF العميل وصفحته (الصفحة العامة /pay/<الرقم> — src/lib/payments/pay-now.ts)',
       notes = coalesce(notes, '') || ' · /pay/<الرقم> صفحة عامة بلا دخول: تنشئ فاتورة ماي فاتورة بإجمالي آخر نسخة (أو تعيد الصالحة بنفس المبلغ) ثم تحوّل العميل؛ المبلغ المخصّص موقّع من الخادم'
 where name = 'ماي فاتورة MyFatoorah'
   and coalesce(notes, '') not like '%/pay/%';

notify pgrst, 'reload schema';

-- ROLLBACK (manual; a link made before any case would block the not-null — delete those first):
--   delete from public.payment_links where operation_id is null;
--   alter table public.payment_links alter column operation_id set not null;
--   drop index if exists public.payment_links_held_idx;
--   drop index if exists public.payment_links_offer_idx;
--   alter table public.payment_links drop column if exists paid_on, drop column if exists paid_amount, drop column if exists offer_id;
