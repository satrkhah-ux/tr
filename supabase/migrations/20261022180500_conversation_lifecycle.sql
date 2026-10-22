-- The conversation's life in Teletel (order 2, part C — the user, 2026-10-22: «اغلاق المحادثات و ارجاعها
-- للموظف التي كانت لديه … نظام تليتيل»). Every closing kept: who (an employee, the system, «مُراد»), when,
-- why, and where it went when the client wrote again — back to the employee who closed it, or unassigned
-- to intake when the system did. Written by the server only (src/lib/leads/lifecycle.ts, service role).

create table if not exists public.conversation_closures (
  id uuid primary key default gen_random_uuid(),
  conversation_id bigint not null,
  closed_at timestamptz not null,
  closed_by_kind text not null check (closed_by_kind in ('employee', 'system', 'murad')),
  -- the Teletel agent who resolved it (employees.teletel_agent_id maps it to a person)
  closed_by_agent_id integer,
  closed_by_name text,
  -- who held it at the closing
  assignee_agent_id integer,
  reason text,
  reopened_at timestamptz,
  reopen_action text check (reopen_action in ('returned_to_employee', 'unassigned', 'kept')),
  reopened_to_agent_id integer,
  created_at timestamptz not null default now()
);

create index if not exists conversation_closures_conversation_idx on public.conversation_closures (conversation_id, closed_at desc);
-- one closing awaiting the client's return per conversation
create unique index if not exists conversation_closures_waiting_idx on public.conversation_closures (conversation_id) where reopened_at is null;

alter table public.conversation_closures enable row level security;
drop policy if exists conversation_closures_staff_read on public.conversation_closures;
create policy conversation_closures_staff_read on public.conversation_closures
  for select to authenticated using (public.is_staff());
grant select on public.conversation_closures to authenticated;

-- where each conversation stands, for «الشاشات» and the manager screen /m (order 3)
alter table public.client_leads add column if not exists conversation_state text;
alter table public.client_leads add column if not exists closed_at timestamptz;
alter table public.client_leads add column if not exists closed_by_kind text;
alter table public.client_leads add column if not exists closed_by_name text;

alter table public.client_leads drop constraint if exists client_leads_conversation_state_check;
alter table public.client_leads add constraint client_leads_conversation_state_check
  check (conversation_state is null or conversation_state in ('waiting', 'open', 'closed_by_employee', 'closed_by_system', 'travelling'));
alter table public.client_leads drop constraint if exists client_leads_closed_by_kind_check;
alter table public.client_leads add constraint client_leads_closed_by_kind_check
  check (closed_by_kind is null or closed_by_kind in ('employee', 'system', 'murad'));

comment on column public.client_leads.conversation_state is 'waiting: the client waits on our reply · open: we spoke last · closed_by_employee / closed_by_system: resolved in Teletel · travelling: a confirmed traveller closed under that class';
comment on column public.client_leads.closed_by_kind is 'who resolved the conversation in Teletel: employee, system, murad (history in conversation_closures)';
