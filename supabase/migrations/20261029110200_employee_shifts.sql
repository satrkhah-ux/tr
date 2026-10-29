-- A colleague's own working hours (the owner, 2026-10-29) — session B.
--
--   employee_shifts  a shift that overrides the department's or the office's hours for one colleague: a night shift, a
--                    split shift, other days. `hours` is the same text as مُراد's reception hours («السبت-الخميس
--                    10:30-12:30 16:00-00:00 | الجمعة 16:00-00:00»), so one parser reads both (murad/reception.ts
--                    parseHours). From `starts_on`, until `ends_on` (inclusive) when set; the newest that covers a day is
--                    the colleague's shift that day. Kept as history: a change is a new row, an end is an `ends_on`.
--
-- Closed like the other presence tables: RLS on, no policy; only the service role reads and writes, after the server
-- checked who is asking (src/lib/data/presence-status.ts).

create table if not exists public.employee_shifts (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  hours text not null check (length(hours) between 1 and 400),
  starts_on date not null default ((now() at time zone 'Asia/Riyadh')::date),
  ends_on date,
  note text not null default '' check (length(note) <= 200),
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists employee_shifts_by_employee on public.employee_shifts (employee_id, starts_on desc);

alter table public.employee_shifts enable row level security;
revoke all on public.employee_shifts from anon, authenticated;
grant select, insert, update, delete on public.employee_shifts to service_role;
grant usage on sequence public.employee_shifts_id_seq to service_role;
