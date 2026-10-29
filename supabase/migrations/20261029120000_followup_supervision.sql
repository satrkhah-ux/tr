-- «إشراف المتابعة» (the owner, 2026-10-29, session C). Inside «المتابعة», not
-- beside it: the cases point at sla_followups / the Teletel conversation the
-- follow-up already holds — no second copy of clients, employees or messages.
--
-- followup_supervisors: an existing employee named «مشرف متابعة» over a scope
--   (one employee, a Teletel team, a Teletel inbox, or everyone), primary or
--   backup (the backup takes the case while the primary is away). A
--   supervisor never owns the conversation.
-- followup_supervision_cases: one row per (conversation, reason) while open —
--   what the sweep found, where it stands in the chain (employee → supervisor
--   → manager), the supervisor's directive and due time, and how it ended
--   (proof_kind: a real act — a message sent, a call logged with its result,
--   a reassignment, the client's reply — never a bare «تمت»).
--
-- Closed tables like the rest of ours: RLS on with no policies + default
-- grants revoked; only the service role behind the server actions reaches them.
-- NOT applied by the session: the coordinator applies it after a backup.
-- Dry run: begin; \i this file; rollback;   Rollback: scripts/rollback-followup-supervision.sql

create table if not exists public.followup_supervisors (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references public.employees(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('employee', 'team', 'inbox', 'all')),
  -- the employee uuid / Teletel team id / Teletel inbox id as text; '' for 'all'
  scope_ref text not null default '' check (char_length(scope_ref) <= 64),
  role text not null default 'primary' check (role in ('primary', 'backup')),
  active boolean not null default true,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists followup_supervisors_unique
  on public.followup_supervisors (supervisor_id, scope_kind, scope_ref);

create table if not exists public.followup_supervision_cases (
  id uuid primary key default gen_random_uuid(),
  followup_id uuid references public.sla_followups(id) on delete cascade,
  conversation_id bigint not null,
  -- the employee responsible at detection, and now (a reassignment moves it)
  employee_id uuid references public.employees(id) on delete set null,
  supervisor_id uuid references public.employees(id) on delete set null,
  reason text not null check (reason in ('client_waiting', 'followup_overdue', 'no_next_action', 'repeated_postpone')),
  priority text not null default 'normal' check (priority in ('high', 'normal', 'low')),
  -- where the case stands: the employee was told → the supervisor holds it → the manager holds it
  level text not null default 'employee' check (level in ('employee', 'supervisor', 'manager')),
  status text not null default 'open' check (status in ('open', 'closed')),
  detected_at timestamptz not null default now(),
  -- when the current level's grace ends (business time already counted in)
  level_due_at timestamptz,
  last_evaluated_at timestamptz not null default now(),
  -- the condition's own clock: since when the client waits / the step was due
  since_at timestamptz,
  directive text check (char_length(directive) <= 1000),
  directive_due_at timestamptz,
  escalated_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.employees(id) on delete set null,
  close_note text check (char_length(close_note) <= 1000),
  proof_kind text check (proof_kind in ('message_sent', 'call_logged', 'reassigned', 'client_replied', 'resolved', 'followup_closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- no duplicate alert for the same case: one OPEN row per conversation and reason
create unique index if not exists followup_supervision_cases_open
  on public.followup_supervision_cases (conversation_id, reason) where status = 'open';
create index if not exists followup_supervision_cases_status
  on public.followup_supervision_cases (status, level, detected_at desc);
create index if not exists followup_supervision_cases_employee
  on public.followup_supervision_cases (employee_id, status);

alter table public.followup_supervisors enable row level security;
alter table public.followup_supervision_cases enable row level security;
revoke all on public.followup_supervisors from anon, authenticated;
revoke all on public.followup_supervision_cases from anon, authenticated;
