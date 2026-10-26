-- «مركز الإشعارات» (the owner, 2026-10-26): one notification store per employee,
-- filled ONLY through notifyEmployee (src/lib/notifications/notify.ts) and read
-- by the bell and مُراد's floating counter. Closed table like the rest of ours:
-- RLS on with no policies + default grants revoked — only the service role
-- behind server actions reaches it, and the actions scope every call to the
-- signed-in employee.
--
-- NOT applied to the live database by code: the coordinator presents it to the
-- owner (backup first). Rollback: scripts/rollback-employee-notifications.sql.
-- Dry run: node scripts/db-apply.mjs on a throwaway DB, or BEGIN; \i file; ROLLBACK;
create table if not exists public.employee_notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  -- reminder | waiting | hot | offer_due | proposal_ready | draft_ready | ops | mail | visa | ...
  kind text not null check (char_length(kind) between 1 and 40),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 1000),
  -- an in-system path («/secretary», «/followups/<id>») the click opens
  href text check (char_length(href) <= 300),
  -- which part of the system raised it (secretary, operations, visas, mail…)
  source text not null default '' check (char_length(source) <= 40),
  -- the same event never lands twice: unique per employee while set
  dedupe_key text check (char_length(dedupe_key) <= 200),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists employee_notifications_employee_created
  on public.employee_notifications (employee_id, created_at desc);

create unique index if not exists employee_notifications_dedupe
  on public.employee_notifications (employee_id, dedupe_key) where dedupe_key is not null;

alter table public.employee_notifications enable row level security;
revoke all on public.employee_notifications from anon, authenticated;
