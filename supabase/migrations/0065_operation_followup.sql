-- Operations order 6: what a case needs after its bookings — alerts that are
-- sent once, the problems met during the trip, and the client's rating after it.
--
--  · operation_alerts — one row per alert sent (operation, kind, key): the daily
--    job checks it first, so «7 days before travel» goes out once, not daily.
--  · operation_issues — a problem during the trip: what, when, who logged it,
--    how it was solved.
--  · operation_ratings — the client's score (1–5) and words after the return,
--    given through the trip link (/trip/<token>/rate). One per operation.

create table if not exists public.operation_alerts (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations (id) on delete cascade,
  kind text not null,
  ref text not null default '',
  sent_at timestamptz not null default now(),
  unique (operation_id, kind, ref)
);

create table if not exists public.operation_issues (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations (id) on delete cascade,
  happened_at timestamptz not null default now(),
  description text not null check (length(trim(description)) > 0),
  resolution text,
  resolved_at timestamptz,
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists operation_issues_operation_idx on public.operation_issues (operation_id, happened_at desc);

create table if not exists public.operation_ratings (
  operation_id uuid primary key references public.operations (id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

alter table public.operation_alerts enable row level security;
alter table public.operation_issues enable row level security;
alter table public.operation_ratings enable row level security;

drop policy if exists operation_alerts_staff on public.operation_alerts;
create policy operation_alerts_staff on public.operation_alerts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists operation_issues_staff on public.operation_issues;
create policy operation_issues_staff on public.operation_issues
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- the rating is written by the traveller through the token (service role) and read by staff
drop policy if exists operation_ratings_staff on public.operation_ratings;
create policy operation_ratings_staff on public.operation_ratings
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

notify pgrst, 'reload schema';
