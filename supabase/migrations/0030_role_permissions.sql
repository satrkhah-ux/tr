-- ============================================================================
-- 0030 — roles that actually grant something, and cannot be self-granted
--
-- `roles` carried a `permissions jsonb` column that was `{}` on every row and
-- read by nothing: the app's real permission model was a hardcoded table of four
-- roles in TypeScript. So the roles screen let you tick boxes that changed
-- nothing, and «الاوبريشن» and «مبيعات» were labels.
--
-- This makes the role the source of truth, and closes the hole that opening it
-- would otherwise widen: `employees` and `roles` were writable by ANY signed-in
-- user through PostgREST, so an employee could set their own role_id — or rename
-- their own role — and become an administrator without touching the app.
-- ============================================================================

-- ---------- the grant itself ----------
alter table public.roles add column if not exists permission_keys text[] not null default '{}';
-- what the section is FOR, in the admin's own words. Printed on the screen so
-- "what does someone in this role do" is answerable without reading the ticks.
alter table public.roles add column if not exists description text;
alter table public.roles add column if not exists sort integer not null default 100;

-- dead: `{}` on every row, read by nothing.
alter table public.roles drop column if exists permissions;

-- ---------- seed the four existing sections with real, practical sets ----------
-- Idempotent and keyed on english_name so re-running cannot duplicate a role.
update public.roles set
  permission_keys = array[
    'dashboard.admin','dashboard.employee','offers.write','data.write','employees.manage',
    'settings.manage','kanban.view','guide.view','pricing.view','pricing.internal',
    'repackage.write','operations.write','operations.passport'
  ],
  description = 'إدارة كاملة: كل الشاشات، الأرباح والتكاليف، الموظفون والصلاحيات.',
  sort = 10
where english_name = 'All Permissions';

update public.roles set
  permission_keys = array[
    'dashboard.employee','offers.write','data.write','kanban.view','guide.view',
    'pricing.view','repackage.write'
  ],
  description = 'بناء العروض وتسعيرها للعميل ومتابعة مسارها. لا يرى سعر الشراء ولا الأرباح.',
  sort = 20
where english_name = 'sales';

update public.roles set
  permission_keys = array[
    'dashboard.employee','data.write','kanban.view','guide.view',
    'operations.write','operations.passport'
  ],
  description = 'تنفيذ الملفات المؤكَّدة: الحجوزات، الفوتشرات، بيانات الجوازات. لا يرى الأرباح.',
  sort = 30
where english_name = 'Operation';

update public.roles set
  permission_keys = array[
    'dashboard.employee','data.write','guide.view','operations.write','operations.passport'
  ],
  description = 'ملفات التأشيرات وبيانات الجوازات المرتبطة بها.',
  sort = 40
where english_name = 'Visa';

-- ---------- the lockdown ----------
-- READS stay open to any signed-in user: the app lists colleagues and roles all
-- over the place. WRITES have no policy at all, so PostgREST refuses them for
-- anon and authenticated alike; the only path is src/lib/data/team.ts, which runs
-- on the service role behind the `employees.manage` permission and writes an
-- audit row. Same posture as the passport table (0024) and the vault (0017).
drop policy if exists authenticated_all on public.roles;
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated using (true);

drop policy if exists authenticated_all on public.employees;
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated using (true);
