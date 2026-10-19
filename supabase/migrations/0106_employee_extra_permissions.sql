-- ============================================================================
-- 0106 — a permission for ONE colleague, on top of their role (the owner,
-- 2026-10-19: «اريد ان يطلع هذا الموظف على قسم البيانات» — one salesperson
-- sees «البيانات» without the whole «مبيعات» role getting it).
--
--  · employees.extra_permission_keys: added to the role's keys, never removed
--    from them. Written only by the app's team.ts (service role, employees.manage,
--    audited) — sessions cannot write employees since 0030.
--  · staff_can(p): role keys ∪ the colleague's own (roles.ts grantedPermissions
--    is the app's side; staff-can.test.ts pins both). A colleague without a role
--    still gets their own keys.
-- Idempotent.
-- ============================================================================

alter table public.employees
  add column if not exists extra_permission_keys text[] not null default '{}';

comment on column public.employees.extra_permission_keys is
  'Permissions this colleague holds beyond their role (0106). Written by team.ts only.';

create or replace function public.staff_can(p text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.employees e
      left join public.roles r on r.id = e.role_id
     where e.auth_user_id = auth.uid()
       and e.status = 'Active'
       and p = any (coalesce(r.permission_keys, '{}') || e.extra_permission_keys)
  );
$$;
comment on function public.staff_can(text) is
  'currentCan() in SQL: the signed-in user is an Active employee whose role, or own extra keys (0106), grant permission p.';
revoke all on function public.staff_can(text) from public, anon;
grant execute on function public.staff_can(text) to authenticated, service_role;
