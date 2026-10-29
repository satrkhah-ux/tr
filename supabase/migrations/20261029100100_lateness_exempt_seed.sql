-- «لا يُحسب عليهم تأخير» (the owner, 2026-10-29): the morning desk (محمد الحبيب — every request in the office is
-- his) and the whole visa department count no delay anywhere. The first value of the administration's setting
-- app_settings lateness_exempt (src/lib/leads/lateness.ts), edited afterwards on «الإدارة ← إدارة المحادثات».
-- Written only when nobody has set it yet; staff and the department by name, the Teletel team «قسم فيزا» by its id.

insert into public.app_settings (key, value, updated_at)
select
  'lateness_exempt',
  jsonb_build_object(
    'employees', coalesce((select jsonb_agg(e.id) from public.employees e where e.status = 'Active' and e.arabic_name = 'محمد الحبيب'), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(r.id) from public.roles r where r.arabic_name = 'التأشيرات'), '[]'::jsonb),
    'teams', jsonb_build_array(1)
  )::text,
  now()
on conflict (key) do nothing;
