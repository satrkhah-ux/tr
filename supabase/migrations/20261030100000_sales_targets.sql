-- «أهداف المبيعات» (the owner, 2026-10-30): each seller's monthly sales target in riyals.
-- month null = the standing monthly target; a month (its 1st day) = that month's override.
--
-- Closed like 0092: RLS on with NO policy and no grant to anon/authenticated —
-- the app reads and writes it through the service client after currentCan
-- (commissions.view for one's own row, commissions.manage to edit). A colleague's
-- target is never readable from a browser session.
--
-- Copies the targets typed so far from app_settings('sales_targets') — idempotent,
-- a row already here is left as it is. The app_settings key is NOT removed here.

create table if not exists public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  month date check (month is null or extract(day from month) = 1),
  amount numeric(14, 2) not null check (amount > 0 and amount <= 100000000),
  updated_by uuid references public.employees (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint sales_targets_employee_month_key unique nulls not distinct (employee_id, month)
);

alter table public.sales_targets enable row level security;
revoke all on public.sales_targets from anon, authenticated;

-- ---------- the targets typed so far (app_settings JSON) ----------
-- {"monthly": {"<employee id>": amount}, "months": {"YYYY-MM": {"<employee id>": amount}}}
-- a bad entry (unknown employee, not a number, out of range) is skipped, never guessed.
do $$
declare
  raw jsonb;
begin
  select value::jsonb into raw from public.app_settings where key = 'sales_targets';
  if raw is null then
    return;
  end if;

  insert into public.sales_targets (employee_id, month, amount)
  select e.id, null, (m.value #>> '{}')::numeric
  from jsonb_each(coalesce(raw -> 'monthly', '{}'::jsonb)) m
  join public.employees e on e.id::text = m.key
  where jsonb_typeof(m.value) = 'number' and (m.value #>> '{}')::numeric > 0 and (m.value #>> '{}')::numeric <= 100000000
  on conflict on constraint sales_targets_employee_month_key do nothing;

  insert into public.sales_targets (employee_id, month, amount)
  select e.id, to_date(mo.key || '-01', 'YYYY-MM-DD'), (t.value #>> '{}')::numeric
  from jsonb_each(coalesce(raw -> 'months', '{}'::jsonb)) mo
  cross join lateral jsonb_each(case when jsonb_typeof(mo.value) = 'object' then mo.value else '{}'::jsonb end) t
  join public.employees e on e.id::text = t.key
  where mo.key ~ '^\d{4}-(0[1-9]|1[0-2])$'
    and jsonb_typeof(t.value) = 'number' and (t.value #>> '{}')::numeric > 0 and (t.value #>> '{}')::numeric <= 100000000
  on conflict on constraint sales_targets_employee_month_key do nothing;
end $$;

notify pgrst, 'reload schema';
