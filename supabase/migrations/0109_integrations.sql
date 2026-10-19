-- «الربط الخارجي» (the owner, 2026-10-19): everything the system connects to
-- outside itself — servers, the database, APIs, bots, sheets, scripts, domains,
-- subscriptions, scheduled jobs — one row each, with where its secret lives
-- (an env var NAME or a file path, never a value), its account and plan, when
-- it runs out, and its automatic health. The Ads Script posted to a dead IP for
-- two months and the bot's Teletel token was dead, and nobody knew.
--
-- Read and written through the service role behind settings.manage
-- (lib/data/integrations.ts); no session reads it.

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('server', 'database', 'api', 'bot', 'sheet', 'script', 'domain', 'subscription', 'cron', 'service')),
  used_by text,
  -- where the secret lives: an env var name or a server file path — never the value
  secret_ref text,
  account text,
  plan text,
  cost text,
  renews_on date,
  notes text,
  -- the automatic check that watches it (lib/developer/checks.ts id), if any
  check_key text,
  -- «غير مستعمل — للحذف»: listed, not removed, until the owner decides
  unused boolean not null default false,
  last_ok_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  fail_streak integer not null default 0,
  -- the last alert sent for it ('fail', 'expiry:14' …): one alert per problem, not every run
  alerted text,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists integrations_name_key on public.integrations (name);

alter table public.integrations enable row level security;
revoke all on public.integrations from anon, authenticated;
