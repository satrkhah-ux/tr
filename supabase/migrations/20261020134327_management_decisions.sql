begin;
create table if not exists public.management_decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 500),
  evidence text not null default '',
  source_key text,
  source_at timestamptz,
  owner_id uuid not null references public.employees(id),
  due_on date not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.management_decisions enable row level security;
revoke all on public.management_decisions from anon, authenticated;
grant select, insert, update on public.management_decisions to service_role;
create index if not exists management_decisions_due on public.management_decisions(status, due_on);

-- The existing Teletel connection now also supplies Murad's staff/inbox selectors.
update public.integrations
set used_by = concat_ws('؛ ', used_by, 'إعدادات مُراد: صناديق الرد والأقسام وتحويل الطلب إلى موظف'),
    updated_at = now()
where check_key = 'teletel'
  and coalesce(used_by, '') not like '%إعدادات مُراد%';

commit;
