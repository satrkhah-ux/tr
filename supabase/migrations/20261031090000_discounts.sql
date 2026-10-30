-- «قسم الخصومات» (the owner, 2026-10-31): a campaign of personal coupons — one per client, in their name and number,
-- sent on WhatsApp with a link to a coupon page carrying a QR; an employee scans it inside the system and the
-- coupon is used once. Closed to sessions (RLS on, no policy): only the server reads or writes them.
create table if not exists public.discount_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  kind text not null check (kind in ('amount', 'percent')),
  value numeric(10, 2) not null check (value > 0),
  applies_to text not null default 'package' check (applies_to in ('package', 'any')),
  valid_days int not null check (valid_days between 1 and 365),
  audience text not null check (char_length(audience) <= 40),
  audience_days int,
  status text not null default 'draft' check (status in ('draft', 'sending', 'done')),
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.discount_coupons (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.discount_campaigns (id) on delete cascade,
  code text not null unique check (char_length(code) between 6 and 20),
  token text not null unique check (char_length(token) between 20 and 64),
  client_name text,
  phone text not null,
  expires_at timestamptz not null,
  excluded boolean not null default false,
  sent_at timestamptz,
  send_result text,
  sent_by uuid references public.employees (id) on delete set null,
  opened_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references public.employees (id) on delete set null,
  redeemed_ref text check (char_length(redeemed_ref) <= 80),
  created_at timestamptz not null default now(),
  unique (campaign_id, phone)
);
create index if not exists discount_coupons_campaign on public.discount_coupons (campaign_id);

alter table public.discount_campaigns enable row level security;
alter table public.discount_coupons enable row level security;
revoke all on public.discount_campaigns, public.discount_coupons from anon, authenticated;

-- the keys: the administration makes campaigns; every staff role may scan (the owner adjusts both on «الأقسام والصلاحيات»)
update public.roles r
set permission_keys = (select array_agg(distinct k) from unnest(coalesce(r.permission_keys, '{}'::text[]) || array['discounts.manage', 'discounts.redeem']) as k)
where 'dashboard.admin' = any (coalesce(r.permission_keys, '{}'::text[]));
update public.roles r
set permission_keys = (select array_agg(distinct k) from unnest(coalesce(r.permission_keys, '{}'::text[]) || array['discounts.redeem']) as k)
where coalesce(r.permission_keys, '{}'::text[]) && array['dashboard.employee', 'offers.write', 'operations.write', 'operations.own', 'followups.work'];
