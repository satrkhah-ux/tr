-- The partner's account with us (partner order 7): what each confirmed file
-- costs them, what they have paid, and how far we let them run.
--
--  · offers.partner_cost — what a partner owes us for this offer, fixed when it
--    is issued (our prices at its terms, never its own sale price). Written by
--    produceOfferFromDraft; null on our own offers.
--  · partner_invoices — one per confirmed partner offer, numbered, immutable.
--  · partner_payments — money the partner paid US (not its client's payments to
--    it — those are operation_payments), each with a receipt number.
--  · booking_partners.credit_limit — the balance beyond which its «العميل أكّد»
--    is refused; null = no limit.
--
-- Partners READ their own rows (current_partner_id()); only staff write.

alter table public.offers
  add column if not exists partner_cost numeric(14, 2) check (partner_cost is null or partner_cost >= 0);

alter table public.booking_partners
  add column if not exists credit_limit numeric(14, 2) check (credit_limit is null or credit_limit >= 0),
  add column if not exists credit_currency text not null default 'SAR';

create table if not exists public.partner_invoices (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.booking_partners (id) on delete restrict,
  offer_id uuid not null unique references public.offers (id) on delete restrict,
  invoice_no text not null unique,
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null,
  issued_at timestamptz not null default now(),
  note text
);
create index if not exists partner_invoices_partner_idx on public.partner_invoices (partner_id, issued_at desc);

create table if not exists public.partner_payments (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.booking_partners (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null,
  method text not null check (method in ('bank_transfer', 'cash', 'card', 'other')),
  reference text,
  paid_at date not null default current_date,
  receipt_no text not null unique,
  note text,
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists partner_payments_partner_idx on public.partner_payments (partner_id, paid_at desc);

alter table public.partner_invoices enable row level security;
alter table public.partner_payments enable row level security;

drop policy if exists partner_invoices_staff on public.partner_invoices;
create policy partner_invoices_staff on public.partner_invoices
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists partner_invoices_partner_read on public.partner_invoices;
create policy partner_invoices_partner_read on public.partner_invoices
  for select to authenticated using (partner_id = public.current_partner_id());

drop policy if exists partner_payments_staff on public.partner_payments;
create policy partner_payments_staff on public.partner_payments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists partner_payments_partner_read on public.partner_payments;
create policy partner_payments_partner_read on public.partner_payments
  for select to authenticated using (partner_id = public.current_partner_id());

notify pgrst, 'reload schema';
