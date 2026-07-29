-- App Travluin — who is actually doing this booking.
--
-- Until now every booking was implicitly the operations team's own work, which
-- is not how the office runs: some bookings ops issues itself, some go to a
-- partner agency (a DMC, a consolidator, a hotel's own contracting desk), and
-- some go to a named colleague. With no owner on the row, "who is chasing the
-- Baku hotel?" is answered by asking around, and a booking nobody picked up
-- looks identical to one somebody is working on.
--
-- assignee_kind is the discriminator and the two id columns are its payload:
--   'ops'      — the operations team itself (the default, both ids null)
--   'employee' — a named colleague, assignee_employee_id
--   'partner'  — a partner company, assignee_partner_id
-- A check keeps the pairing honest so a row cannot claim 'partner' while
-- pointing at an employee.
-- Idempotent; safe to re-run.

-- ---------- partner companies ----------
create table if not exists public.booking_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- what they handle, so the picker can suggest rather than list everyone
  kinds text[] not null default '{}',
  contact_name text,
  -- E.164 preferred; the WhatsApp handoff resolves a Teletel conversation from it
  phone text,
  email text,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists booking_partners_name_key on public.booking_partners (lower(name));

alter table public.booking_partners enable row level security;
drop policy if exists booking_partners_authenticated_all on public.booking_partners;
create policy booking_partners_authenticated_all
  on public.booking_partners for all to authenticated using (true) with check (true);

-- ---------- assignment on the booking ----------
alter table public.operation_bookings
  add column if not exists assignee_kind text not null default 'ops'
    check (assignee_kind in ('ops', 'employee', 'partner'));

alter table public.operation_bookings
  add column if not exists assignee_employee_id uuid references public.employees (id) on delete set null;

alter table public.operation_bookings
  add column if not exists assignee_partner_id uuid references public.booking_partners (id) on delete set null;

alter table public.operation_bookings
  add column if not exists assigned_at timestamptz;

alter table public.operation_bookings
  add column if not exists assigned_by uuid references public.employees (id) on delete set null;

-- what the assignee was actually asked to do, in the assigner's own words
alter table public.operation_bookings
  add column if not exists handoff_note text;

-- The pairing must match the kind. Added separately and guarded so a re-run on a
-- database that already has it does not fail.
do $$ begin
  alter table public.operation_bookings
    add constraint operation_bookings_assignee_pairing check (
      (assignee_kind = 'ops'      and assignee_employee_id is null and assignee_partner_id is null)
      or (assignee_kind = 'employee' and assignee_employee_id is not null and assignee_partner_id is null)
      or (assignee_kind = 'partner'  and assignee_partner_id  is not null and assignee_employee_id is null)
    );
exception when duplicate_object then null;
end $$;

create index if not exists operation_bookings_assignee_employee_idx
  on public.operation_bookings (assignee_employee_id) where assignee_employee_id is not null;
create index if not exists operation_bookings_assignee_partner_idx
  on public.operation_bookings (assignee_partner_id) where assignee_partner_id is not null;
