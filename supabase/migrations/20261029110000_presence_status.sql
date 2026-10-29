-- Presence, leaves and status buttons (the owner, 2026-10-29) — session B.
--
--   employee_leaves         a colleague's leave, whole Riyadh days, from → to inclusive: no request reaches them and
--                           nothing is counted against them while it lasts (src/lib/presence/availability.ts)
--   staff_meetings          a meeting the administration calls: its invitees get the «اجتماع» button while it is open
--   employee_status_events  «لدي عميل» / «لدي اتصال» / «صلاة» / «اجتماع»: one open at a time per colleague, and never longer
--                           than cap_at (the configurable limit) — a forgotten button closes itself. The client's phone
--                           (digits only) lets their next message come back to the same colleague.
--
-- Closed like the other staff tables: RLS on, no policy; only the service role reads and writes, after the server
-- checked who is asking (src/lib/data/presence-status.ts, the staff bot).

create table if not exists public.employee_leaves (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text not null default '' check (length(reason) <= 300),
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.employees (id) on delete set null,
  check (ends_on >= starts_on)
);
create index if not exists employee_leaves_live on public.employee_leaves (employee_id, starts_on, ends_on) where cancelled_at is null;

create table if not exists public.staff_meetings (
  id bigint generated always as identity primary key,
  title text not null check (length(title) between 1 and 200),
  called_by uuid references public.employees (id) on delete set null,
  invited uuid[] not null default '{}',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists staff_meetings_open on public.staff_meetings (starts_at) where ends_at is null;

create table if not exists public.employee_status_events (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  kind text not null check (kind in ('client', 'call', 'prayer', 'meeting')),
  started_at timestamptz not null default now(),
  cap_at timestamptz not null,
  ended_at timestamptz,
  ended_by text check (ended_by in ('employee', 'auto', 'manager')),
  details jsonb not null default '{}'::jsonb,
  client_phone text check (client_phone is null or client_phone ~ '^[0-9]{6,15}$'),
  meeting_id bigint references public.staff_meetings (id) on delete set null,
  created_at timestamptz not null default now(),
  check (cap_at > started_at)
);
create unique index if not exists employee_status_one_open on public.employee_status_events (employee_id) where ended_at is null;
create index if not exists employee_status_by_phone on public.employee_status_events (client_phone, started_at desc) where client_phone is not null;
create index if not exists employee_status_by_day on public.employee_status_events (started_at desc);

alter table public.employee_leaves enable row level security;
alter table public.staff_meetings enable row level security;
alter table public.employee_status_events enable row level security;
revoke all on public.employee_leaves, public.staff_meetings, public.employee_status_events from anon, authenticated;
grant select, insert, update, delete on public.employee_leaves, public.staff_meetings, public.employee_status_events to service_role;
grant usage on sequence public.employee_leaves_id_seq, public.staff_meetings_id_seq, public.employee_status_events_id_seq to service_role;
