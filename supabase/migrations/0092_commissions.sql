-- ============================================================================
-- 0092 — «العمولات»: the sales commission, inside the system (2026-10-18)
--
-- The administration: one place, every employee sees their own commission. It
-- replaces the separate commission apps (ACC/acctrav, ACC/commissions-Traveliun)
-- and keeps their rules: the target model (company profit against the month's
-- cost → three levels → a pool split by orders and sales), department
-- incentives, money in exact halalas, numbers frozen once a cycle leaves draft,
-- one payout per cycle.
--
-- The owner's choices (2026-10-18): a file counts in the month it is PAID IN
-- FULL, on its ACTUAL profit (money in − supplier cost); an employee sees only
-- their own figures.
--
-- Every table is closed to sessions (RLS on, no policy): commission is profit,
-- and profit is read by the server through the service client after the app's
-- permission check — the 0047 rule for cost. The triggers below hold the money
-- rules even for the service client.
-- Idempotent.
-- ============================================================================

-- ---------- policy: one document per version, approved by someone else ----------
create table if not exists public.commission_policies (
  id uuid primary key default gen_random_uuid(),
  doc jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  note text,
  created_by uuid references public.employees (id) on delete set null,
  approved_by uuid references public.employees (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  -- nobody approves the policy that pays them: the editor is never the approver
  constraint commission_policies_four_eyes check (approved_by is null or created_by is null or approved_by <> created_by)
);
-- at most one policy in force
create unique index if not exists commission_policies_one_approved
  on public.commission_policies ((true)) where status = 'approved';

-- ---------- cycle: one month, draft → review → approved → paid (void beside) ----------
create table if not exists public.commission_cycles (
  id uuid primary key default gen_random_uuid(),
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  monthly_cost numeric(14, 2) not null default 250000 check (monthly_cost >= 0),
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'paid', 'void')),
  policy_id uuid references public.commission_policies (id),
  -- the whole calculation (policy, every file, every share) frozen when it leaves draft
  snapshot jsonb,
  void_reason text,
  created_by uuid references public.employees (id) on delete set null,
  reviewed_by uuid references public.employees (id) on delete set null,
  reviewed_at timestamptz,
  approved_by uuid references public.employees (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint commission_cycles_frozen_has_snapshot check (status in ('draft', 'void') or snapshot is not null),
  constraint commission_cycles_void_reason check (status <> 'void' or coalesce(trim(void_reason), '') <> '')
);
create unique index if not exists commission_cycles_one_live_per_month
  on public.commission_cycles (month) where status <> 'void';

create or replace function public.commission_cycles_guard() returns trigger
language plpgsql as $$
begin
  if old.status in ('paid', 'void') then
    raise exception 'commission cycle % is final', old.status;
  end if;
  if new.status <> old.status and not (
    (old.status = 'draft' and new.status in ('review', 'void')) or
    (old.status = 'review' and new.status in ('draft', 'approved', 'void')) or
    (old.status = 'approved' and new.status in ('paid', 'void'))
  ) then
    raise exception 'commission cycle cannot go from % to %', old.status, new.status;
  end if;
  -- a frozen calculation never moves: back to draft is the only way to recalculate
  if old.status <> 'draft' and new.status <> 'draft' and (
    new.snapshot is distinct from old.snapshot or new.monthly_cost <> old.monthly_cost or new.month <> old.month
  ) then
    raise exception 'commission cycle is frozen';
  end if;
  return new;
end $$;
drop trigger if exists commission_cycles_guard on public.commission_cycles;
create trigger commission_cycles_guard before update on public.commission_cycles
  for each row execute function public.commission_cycles_guard();

-- ---------- adjustments: only while the cycle is a draft, always with a reason ----------
create table if not exists public.commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.commission_cycles (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  amount numeric(12, 2) not null check (amount <> 0),
  reason text not null check (trim(reason) <> ''),
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists commission_adjustments_cycle_idx on public.commission_adjustments (cycle_id);

create or replace function public.commission_adjustments_guard() returns trigger
language plpgsql as $$
declare s text;
begin
  select status into s from public.commission_cycles where id = coalesce(new.cycle_id, old.cycle_id);
  if s is distinct from 'draft' then
    raise exception 'adjustments change only while the cycle is a draft';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists commission_adjustments_guard on public.commission_adjustments;
create trigger commission_adjustments_guard before insert or update or delete on public.commission_adjustments
  for each row execute function public.commission_adjustments_guard();

-- ---------- payout: one per cycle, so a double click pays once ----------
create table if not exists public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null unique references public.commission_cycles (id),
  amount numeric(14, 2) not null check (amount >= 0),
  reference text,
  paid_by uuid references public.employees (id) on delete set null,
  paid_at timestamptz not null default now()
);

alter table public.commission_policies enable row level security;
alter table public.commission_cycles enable row level security;
alter table public.commission_adjustments enable row level security;
alter table public.commission_payouts enable row level security;
revoke all on public.commission_policies, public.commission_cycles, public.commission_adjustments, public.commission_payouts
  from anon, authenticated;

-- ---------- permissions on the existing roles ----------
-- every salesperson sees their own; the administration role runs and approves.
update public.roles set permission_keys = array(select distinct unnest(permission_keys || array['commissions.view']))
  where english_name = 'sales';
update public.roles set permission_keys = array(select distinct unnest(permission_keys || array['commissions.view', 'commissions.manage', 'commissions.approve']))
  where english_name in ('All Permissions', 'Admin');
