-- ============================================================================
-- 0032 — «عين الإدارة»: attendance that has a history, and notes that have an age
--
-- Everything this watcher reports on already exists — audit_logs, care_tickets,
-- operations — with one exception: attendance. `presence` keeps ONE row per
-- employee and overwrites it on every heartbeat, so "when did they arrive" and
-- "when did they stop" cannot be asked of it. One row per employee per day fixes
-- that without a new service: the heartbeat that already runs writes it.
--
-- And notes need an AGE. A watcher that reports the same unanswered ticket every
-- morning as if it were new is noise; one that says «متكرّرة منذ ٣ أيام» is a
-- colleague. That comes from unique(code, subject_id) — a repeat is an UPDATE.
-- ============================================================================

-- ---------- attendance ----------
create table if not exists public.attendance_days (
  employee_id uuid not null references public.employees (id) on delete cascade,
  day date not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  -- heartbeats seen today (one per ~30s while the app is open). Minutes are
  -- DERIVED from this rather than stored: the beat is the only fact we have.
  beats integer not null default 1,
  primary key (employee_id, day)
);

create index if not exists attendance_days_day_idx on public.attendance_days (day desc);

alter table public.attendance_days enable row level security;
-- Readable by the team (the dashboard already shows who is online); written only
-- by the heartbeat, which runs on the server.
drop policy if exists attendance_read on public.attendance_days;
create policy attendance_read on public.attendance_days for select to authenticated using (true);
drop policy if exists attendance_write on public.attendance_days;
create policy attendance_write on public.attendance_days for all to authenticated using (true) with check (true);

-- ---------- what the eye said, and when ----------
create table if not exists public.eye_reports (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  generated_at timestamptz not null default now(),
  -- the computed report, exactly as the script was built from it. Kept so a
  -- number can be traced back to the day it was said.
  report jsonb not null,
  script text not null,
  sent_to integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- what it noticed ----------
create table if not exists public.eye_notes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  subject_kind text not null default 'other',
  -- the thing the note is ABOUT: an employee, a ticket, an operation. Part of the
  -- identity, so the same problem on two different tickets stays two notes.
  subject_id text not null default '',
  severity text not null default 'warn' check (severity in ('critical', 'warn', 'info')),
  title text not null,
  detail text,
  status text not null default 'open' check (status in ('open', 'ack', 'ignored')),
  first_seen_day date not null,
  last_seen_day date not null,
  times_seen integer not null default 1,
  resolved_at timestamptz,
  resolved_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (code, subject_id)
);

create index if not exists eye_notes_open_idx on public.eye_notes (status, severity, last_seen_day desc);

-- ---------- locked ----------
-- NO policy on either, deliberately — the same posture as the passport table
-- (0024) and the credential vault (0017). These rows name colleagues, their
-- delays and the judgement made about them; they are read only through a server
-- action gated on `dashboard.admin`, and written only by the watcher.
alter table public.eye_reports enable row level security;
drop policy if exists eye_reports_all on public.eye_reports;

alter table public.eye_notes enable row level security;
drop policy if exists eye_notes_all on public.eye_notes;

notify pgrst, 'reload schema';
