-- ============================================================================
-- 20261029140200 — payment links recorded by themselves (the owner, 2026-10-29,
-- session E):
--
--   1. payment_links — every MyFatoorah / Tamara link the system made for a
--      case, so the 10-minute job (/api/ops/payments) can ask the gateway
--      whether it was paid. Server-only: RLS on, no policy, no grants — the
--      service role writes it after the employee's own gate.
--   2. operation_payments.provider_ref — the gateway's invoice/order id on a
--      payment it recorded («myfatoorah:<InvoiceId>»), UNIQUE: a paid link is
--      recorded ONCE however many times it is polled.
--
-- NOT applied by code: the coordinator applies it (backup first) BEFORE
-- deploying branch ops-payments. Dry run: scripts/dry-run-ops-payments.mjs.
-- ============================================================================

create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations (id) on delete cascade,
  provider text not null check (provider in ('myfatoorah', 'tamara')),
  -- MyFatoorah InvoiceId / Tamara order_id (its checkout_id when no order yet)
  invoice_id text not null,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'SAR',
  url text not null,
  mock boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'expired')),
  payment_id uuid references public.operation_payments (id) on delete set null,
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  checked_at timestamptz,
  unique (provider, invoice_id)
);

create index if not exists payment_links_pending_idx on public.payment_links (created_at) where status = 'pending';

alter table public.payment_links enable row level security;
revoke all on public.payment_links from anon, authenticated;

comment on table public.payment_links is
  'Payment links made per case (MyFatoorah/Tamara); polled every 10 minutes and recorded once when paid. Service role only. Session E, 2026-10-29.';

alter table public.operation_payments
  add column if not exists provider_ref text;

create unique index if not exists operation_payments_provider_ref_key
  on public.operation_payments (provider_ref) where provider_ref is not null;

comment on column public.operation_payments.provider_ref is
  'The gateway reference of a payment recorded from a paid link («myfatoorah:<InvoiceId>»). Unique — one row per paid link.';

-- «الربط الخارجي»: the job that asks the gateways
insert into public.integrations (name, kind, used_by, secret_ref, account, check_key, notes)
values (
  'تسجيل روابط السداد تلقائياً',
  'cron',
  'العمليات — كل رابط ماي فاتورة/تمارا أُرسل يُسأل عنه كل 10 دقائق؛ المدفوع يُسجَّل دفعة مرة واحدة ويُنبَّه الموظف (src/lib/operations/payment-links-poll.ts)',
  'ADMIN_API_SECRET (+ MYFATOORAH_API_KEY / TAMARA_API_TOKEN)',
  'vps-new / traveliun-app — crontab: كل 10 دقائق POST /api/ops/payments',
  'job_payment_links',
  'لا رسالة للعميل من هذه المهمة أبداً. بلا مفتاح البوابة تبقى الروابط «بانتظار الدفع» (وضع تجريبي).'
)
on conflict (name) do update set check_key = excluded.check_key;

notify pgrst, 'reload schema';

-- ROLLBACK (manual):
--   delete from public.integrations where name = 'تسجيل روابط السداد تلقائياً';
--   drop index if exists public.operation_payments_provider_ref_key;
--   alter table public.operation_payments drop column if exists provider_ref;
--   drop table if exists public.payment_links;
