-- App Travluin — dashboard metrics foundation:
-- (1) turn care_tickets into a real "requests" model (assigned employee, type, responded),
-- (2) live presence table for online-now / active-today,
-- (3) seed demonstrable request + presence data.

-- 1) requests model
alter table public.care_tickets add column if not exists employee_id uuid references public.employees(id) on delete set null;
alter table public.care_tickets add column if not exists type text;
alter table public.care_tickets add column if not exists responded_at timestamptz;
create index if not exists care_tickets_employee_id_idx on public.care_tickets (employee_id);
create index if not exists care_tickets_created_at_idx on public.care_tickets (created_at);

-- 2) live presence (updated by the app heartbeat). Keyed by employee so the
--    admin view can attribute online users to employees.
create table if not exists public.presence (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  last_seen_at timestamptz not null default now()
);
alter table public.presence enable row level security;
drop policy if exists authenticated_all on public.presence;
create policy authenticated_all on public.presence for all to authenticated using (true) with check (true);

-- 3) seed requests across employees (types / answered / pending / today vs older)
do $$
declare
  admin_id uuid := (select id from public.employees where english_name = 'Admin' limit 1);
  emp2 uuid := (select id from public.employees where english_name = 'abd alrazaq' limit 1);
  emp3 uuid := (select id from public.employees where english_name = 'ahmed yousif' limit 1);
begin
  if not exists (select 1 from public.care_tickets where type is not null) then
    insert into public.care_tickets (customer, subject, status, type, employee_id, responded_at, created_at) values
      ('نايف الجهني', 'استفسار عن باقة ماليزيا', 'answered', 'استفسار', admin_id, now(), now()),
      ('سارة القحطاني', 'تعديل موعد الرحلة', 'pending', 'تعديل', admin_id, null, now()),
      ('الأستاذة هند', 'تعديل عدد المسافرين', 'answered', 'تعديل', admin_id, now(), now()),
      ('بدر حسين', 'استفسار عن الأسعار', 'pending', 'استفسار', admin_id, null, now() - interval '3 day'),
      ('عبدالله', 'حجز فندق إضافي', 'answered', 'حجز', emp2, now(), now() - interval '1 day'),
      ('رهف', 'شكوى بخصوص التوصيل', 'pending', 'شكوى', emp2, null, now()),
      ('رؤى الردادي', 'حجز جولة سياحية', 'pending', 'حجز', emp2, null, now()),
      ('خالد', 'استفسار عن التأشيرة', 'answered', 'استفسار', emp3, now(), now() - interval '2 day'),
      ('أمجد الشهري', 'تعديل مسار الرحلة', 'pending', 'تعديل', emp3, null, now()),
      ('أم يوسف', 'استفسار عن الفعاليات', 'answered', 'استفسار', emp3, now(), now());
  end if;
end $$;

-- seed a couple of "currently online" employees (fresh last_seen). The app
-- heartbeat keeps the signed-in user's row fresh; these age out naturally.
insert into public.presence (employee_id, last_seen_at)
select id, now() from public.employees where english_name in ('abd alrazaq', 'ahmed yousif')
on conflict (employee_id) do update set last_seen_at = now();
