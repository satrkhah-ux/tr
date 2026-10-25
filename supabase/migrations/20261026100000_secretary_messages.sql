-- «سكرتيري الخاص» (the owner, 2026-10-24, order 2): each employee's private chat
-- with their secretary, and the day plan it sent. Closed table: RLS on with no
-- policies, so only the service role (server actions, src/lib/secretary/*)
-- reads or writes — the actions themselves scope every call to the signed-in
-- employee, so nobody sees another's thread.
create table if not exists public.secretary_messages (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  -- 'user' the employee, 'secretary' the answer, 'plan' the day-start plan
  role text not null check (role in ('user', 'secretary', 'plan')),
  content text not null check (char_length(content) <= 8000),
  created_at timestamptz not null default now()
);

create index if not exists secretary_messages_employee_created
  on public.secretary_messages (employee_id, created_at desc);

alter table public.secretary_messages enable row level security;

-- belt over the braces: RLS with no policies already denies everyone but the
-- service role; revoking the default grants keeps it denied even if a policy
-- is ever added carelessly (same hardening as my_followup_* tables).
revoke all on public.secretary_messages from anon, authenticated;
