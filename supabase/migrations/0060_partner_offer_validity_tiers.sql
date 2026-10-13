-- Partner order 9: how long a partner's offer holds, renewing it at today's
-- prices, and a commission that steps down with volume.
--
--  · offers.valid_until — the last day an issued offer's prices hold. New
--    offers get seven days (Riyadh); offers issued before this have none.
--  · offer_renewals — an expired offer renewed into a fresh draft, so the new
--    offer can show what the old one cost.
--  · partner_commission_tiers — after N confirmed files in a quarter, the
--    company's percentage becomes `pct`. partner_id null = the default ladder
--    for companies with none of their own.

alter table public.offers add column if not exists valid_until date;
alter table public.offers
  alter column valid_until set default ((now() at time zone 'Asia/Riyadh')::date + 7);

create table if not exists public.offer_renewals (
  id uuid primary key default gen_random_uuid(),
  old_offer_id uuid not null references public.offers (id) on delete cascade,
  new_draft_id uuid not null,
  partner_id uuid references public.booking_partners (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (new_draft_id)
);

create table if not exists public.partner_commission_tiers (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.booking_partners (id) on delete cascade,
  min_confirmed integer not null check (min_confirmed > 0),
  pct numeric(5, 2) not null check (pct >= 0 and pct <= 100),
  created_at timestamptz not null default now()
);
create unique index if not exists partner_commission_tiers_step_key
  on public.partner_commission_tiers (coalesce(partner_id, '00000000-0000-0000-0000-000000000000'::uuid), min_confirmed);

alter table public.offer_renewals enable row level security;
alter table public.partner_commission_tiers enable row level security;

drop policy if exists offer_renewals_staff on public.offer_renewals;
create policy offer_renewals_staff on public.offer_renewals
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists offer_renewals_partner_read on public.offer_renewals;
create policy offer_renewals_partner_read on public.offer_renewals
  for select to authenticated using (partner_id = public.current_partner_id());

drop policy if exists partner_commission_tiers_staff on public.partner_commission_tiers;
create policy partner_commission_tiers_staff on public.partner_commission_tiers
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists partner_commission_tiers_partner_read on public.partner_commission_tiers;
create policy partner_commission_tiers_partner_read on public.partner_commission_tiers
  for select to authenticated
  using (partner_id is null or partner_id = public.current_partner_id());

notify pgrst, 'reload schema';
