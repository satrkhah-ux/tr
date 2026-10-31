-- «حسابات الدخول» (the owner, 2026-10-31): the company's logins scattered among the staff — social media, websites,
-- systems, booking companies — gathered in one place. Any employee adds the logins they hold; the administration
-- (logins.manage) sees them all. The password is encrypted with the existing vault (src/lib/crypto/secrets.ts —
-- AES-256-GCM under SETTINGS_ENCRYPTION_KEY) and only shown on «اعرض», each showing audited.
-- Closed table: RLS on with no policies + grants revoked — only the service role behind lib/logins/actions.ts.
create table if not exists public.shared_logins (
  id uuid primary key default gen_random_uuid(),
  -- what it is: «انستقرام ترافليون», «بوابة TBO», «حساب Booking.com»
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'other' check (kind in ('social', 'website', 'system', 'booking', 'email', 'other')),
  url text check (char_length(url) <= 500),
  username text check (char_length(username) <= 200),
  email text check (char_length(email) <= 200),
  phone text check (char_length(phone) <= 40),
  password_enc text check (char_length(password_enc) <= 4000),
  notes text check (char_length(notes) <= 1000),
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shared_logins_created_by on public.shared_logins (created_by);

alter table public.shared_logins enable row level security;
revoke all on public.shared_logins from anon, authenticated;

-- the administration sees and manages every login
update public.roles r
set permission_keys = (select array_agg(distinct k) from unnest(coalesce(r.permission_keys, '{}'::text[]) || array['logins.manage']) as k)
where 'dashboard.admin' = any (coalesce(r.permission_keys, '{}'::text[]));
