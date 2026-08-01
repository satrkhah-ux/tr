-- App Travluin — what a partner's own home screen is allowed to read.
--
-- Three additions, each tied to a screen:
--
--   ready_offers      «العروض الجاهزة». Our seasonal packages, which exist to be
--                     resold — so partner_resell defaults to true and a staff
--                     member turns it OFF for anything not meant to leave the
--                     building. A partner sees only active + resellable rows.
--
--   operations        «الطلبات». The status of THEIR files once a client says
--   operation_payments yes, and the money recorded against them. Read-only: a
--                     partner watches operations work, they do not do it.
--
-- Scoped through offers.partner_company_id in both cases, which is the same
-- column 0035 already made the ownership test everywhere else.

alter table public.ready_offers
  add column if not exists partner_resell boolean not null default true;

comment on column public.ready_offers.partner_resell is
  'Visible to partner companies for review/resale. Off = ours only.';

drop policy if exists ready_offers_partner_read on public.ready_offers;
create policy ready_offers_partner_read on public.ready_offers
  for select to authenticated
  using (
    public.current_partner_id() is not null
    and coalesce(active, true)
    and coalesce(partner_resell, false)
  );

drop policy if exists operations_partner_read on public.operations;
create policy operations_partner_read on public.operations
  for select to authenticated
  using (
    exists (
      select 1 from public.offers o
      where o.id = operations.offer_id
        and o.partner_company_id = public.current_partner_id()
    )
  );

drop policy if exists operation_payments_partner_read on public.operation_payments;
create policy operation_payments_partner_read on public.operation_payments
  for select to authenticated
  using (
    exists (
      select 1
      from public.operations op
      join public.offers o on o.id = op.offer_id
      where op.id = operation_payments.operation_id
        and o.partner_company_id = public.current_partner_id()
    )
  );

notify pgrst, 'reload schema';
