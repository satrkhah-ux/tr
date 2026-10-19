-- ============================================================================
-- 0107 — a colleague's permissions can also be TAKEN from what their role gives,
-- and «العملاء» becomes a permission like every other section (the owner,
-- 2026-10-19: «كل الاقسام اضفها الى الصلاحيات … امكانية ازالة او وضع»).
--
--  · employees.removed_permission_keys: subtracted from role ∪ extra (0106).
--  · clients.view: the key that opens «العملاء» (/clients). Every role gets it
--    here, so nobody loses the page today; take it from a role or a colleague.
--  · staff_can(p): (role ∪ extra) − removed — roles.ts grantedPermissions is the
--    app's side; staff-can.test.ts pins both.
-- Idempotent.
-- ============================================================================

alter table public.employees
  add column if not exists removed_permission_keys text[] not null default '{}';

comment on column public.employees.removed_permission_keys is
  'Permissions taken from this colleague although their role gives them (0107). Written by team.ts only.';

update public.roles
   set permission_keys = array(select distinct unnest(coalesce(permission_keys, '{}') || array['clients.view']))
 where not ('clients.view' = any (coalesce(permission_keys, '{}')));

create or replace function public.staff_can(p text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.employees e
      left join public.roles r on r.id = e.role_id
     where e.auth_user_id = auth.uid()
       and e.status = 'Active'
       and p = any (coalesce(r.permission_keys, '{}') || e.extra_permission_keys)
       and not (p = any (e.removed_permission_keys))
  );
$$;
comment on function public.staff_can(text) is
  'currentCan() in SQL: an Active employee whose role or own extra keys grant p, unless p was taken from them (0106, 0107).';
revoke all on function public.staff_can(text) from public, anon;
grant execute on function public.staff_can(text) to authenticated, service_role;
