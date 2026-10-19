-- «رؤية للإعلانات» (the owner, 2026-10-19): the Google Ads account's own
-- numbers beside the conversations Teletel received. The owner's Ads Script
-- posts them every hour to /api/ads/hook (and, unchanged, to the Telegram bot):
-- per day and campaign, and — phase 2 — where the clicks came from, what was
-- searched, and the hour of day. Dates are the account's (Riyadh) days.
--
-- Spend is the company's internal figure: no session reads these tables. The
-- page reads them through the service role behind its own permission check.

create table if not exists public.ad_stats (
  day date not null,
  campaign text not null,
  status text,
  cost numeric(14, 4) not null default 0,
  clicks integer not null default 0,
  impressions integer not null default 0,
  conversions numeric(12, 4) not null default 0,
  currency text,
  -- a day the account has closed (the script's «yesterday» and every backfilled day); today's row is overwritten each hour
  final boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (day, campaign)
);

-- where the people who clicked were (user_location_view)
create table if not exists public.ad_locations (
  day date not null,
  campaign text not null,
  country text not null,
  city text not null default '',
  clicks integer not null default 0,
  impressions integer not null default 0,
  cost numeric(14, 4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, campaign, country, city)
);

-- what they searched (search_term_view), the top terms per campaign and day
create table if not exists public.ad_search_terms (
  day date not null,
  campaign text not null,
  term text not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  cost numeric(14, 4) not null default 0,
  conversions numeric(12, 4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, campaign, term)
);

-- the hour of day the clicks came in (account time)
create table if not exists public.ad_hours (
  day date not null,
  campaign text not null,
  hour smallint not null check (hour between 0 and 23),
  clicks integer not null default 0,
  impressions integer not null default 0,
  cost numeric(14, 4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, campaign, hour)
);

alter table public.ad_stats enable row level security;
alter table public.ad_locations enable row level security;
alter table public.ad_search_terms enable row level security;
alter table public.ad_hours enable row level security;
revoke all on public.ad_stats, public.ad_locations, public.ad_search_terms, public.ad_hours from anon, authenticated;
