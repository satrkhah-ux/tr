-- «الإنذارات المالية» (stage 6, 2026-10-30): one row per alert sent to the management and the accounts team
-- (lib/accounts/alerts.ts keys: expenses:<month>, margin:<case>, late:<case>, target:<employee>:<month>), so the
-- morning job sends each once. The alerts themselves are computed from the records, never stored.
-- Closed to sessions (RLS on, no policy): only the server reads or writes it.
create table if not exists public.finance_alerts (
  key text primary key check (char_length(key) between 1 and 200),
  kind text not null check (kind in ('expenses', 'margin', 'late', 'supplier', 'target')),
  title text not null default '' check (char_length(title) <= 300),
  sent_at timestamptz not null default now()
);

alter table public.finance_alerts enable row level security;
revoke all on public.finance_alerts from anon, authenticated;
