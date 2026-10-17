-- «SLA» (the owner, 2026-10-17): the administration's rules for how long a
-- Teletel conversation may wait — in minutes, hours or days — and the
-- follow-up list a late one moves to, where a manager hands it to an employee
-- who answers it from our system (src/lib/sla/classify.ts, src/lib/data/sla.ts).
--
-- Both service-only (RLS on, no policies): read and written by the server
-- actions behind dashboard.admin / developer.access, and by the assignee for
-- their own follow-ups. Idempotent.

create table if not exists public.sla_rules (
  id uuid primary key default gen_random_uuid(),
  -- first_reply: nobody answered a new conversation · waiting: the client waits
  -- for us · cold: we spoke last and nothing since
  kind text not null check (kind in ('first_reply', 'waiting', 'cold')),
  name text not null,
  amount int not null check (amount > 0),
  unit text not null check (unit in ('minute', 'hour', 'day')),
  color text not null default '#d99a00',
  to_followup boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sla_rules enable row level security;

create table if not exists public.sla_followups (
  id uuid primary key default gen_random_uuid(),
  conversation_id int not null,
  contact_id int,
  contact_name text,
  contact_phone text,
  kind text not null check (kind in ('first_reply', 'waiting', 'cold')),
  rule_id uuid references public.sla_rules (id) on delete set null,
  rule_name text,
  waited_minutes int,
  -- who held it in Teletel when it went late
  teletel_assignee text,
  status text not null default 'open' check (status in ('open', 'done')),
  assigned_to uuid references public.employees (id) on delete set null,
  assigned_by uuid references public.employees (id) on delete set null,
  assigned_at timestamptz,
  replied_at timestamptz,
  done_by uuid references public.employees (id) on delete set null,
  done_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
alter table public.sla_followups enable row level security;
-- one open follow-up per conversation; once done, a later delay opens a new one
create unique index if not exists sla_followups_one_open on public.sla_followups (conversation_id) where status = 'open';
create index if not exists sla_followups_assignee on public.sla_followups (assigned_to) where status = 'open';

-- a starting set the administration edits on the page
insert into public.sla_rules (kind, name, amount, unit, color, to_followup)
select * from (values
  ('first_reply', 'تأخر أول رد', 5, 'minute', '#d99a00', false),
  ('first_reply', 'عميل جديد بلا رد', 30, 'minute', '#c22850', true),
  ('waiting', 'متأخر', 15, 'minute', '#d99a00', false),
  ('waiting', 'حرج', 2, 'hour', '#c22850', true),
  ('cold', 'فاتر', 1, 'day', '#6b7a99', false),
  ('cold', 'بارد', 3, 'day', '#2f7fc0', true)
) as v (kind, name, amount, unit, color, to_followup)
where not exists (select 1 from public.sla_rules);

-- «ينقل إلى» may name a Teletel TEAM instead of our «المتابعة» (the owner,
-- 2026-10-17): the conversation is assigned to that team there, with a team
-- note saying why, and the move is logged so the same rule never moves the
-- same conversation twice in a week (a ping-pong with a colleague who moves it back).
alter table public.sla_rules add column if not exists teletel_team_id int;
alter table public.sla_rules add column if not exists teletel_team_name text;

create table if not exists public.sla_moves (
  id uuid primary key default gen_random_uuid(),
  conversation_id int not null,
  team_id int not null,
  team_name text,
  rule_id uuid references public.sla_rules (id) on delete set null,
  rule_name text,
  waited_minutes int,
  created_at timestamptz not null default now()
);
alter table public.sla_moves enable row level security;
create index if not exists sla_moves_recent on public.sla_moves (conversation_id, team_id, created_at desc);
