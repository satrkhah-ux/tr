-- «تنبيهاتي» stage d (the owner, 2026-10-22): every evening each employee gets
-- their day's numbers and two or three tips that stand on those numbers
-- (lib/telegram/staff-report.ts).
--
-- staff_bot_reports — one row per employee per Riyadh day. It is claimed BEFORE
-- the send, so the minute job never sends a report twice. It keeps the numbers
-- and the tips as they were sent, so tomorrow's tips can be compared with today's.

create table if not exists public.staff_bot_reports (
  day date not null,
  employee_id uuid not null references public.employees (id) on delete cascade,
  numbers jsonb,
  tips text[],
  sent boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (day, employee_id)
);
alter table public.staff_bot_reports enable row level security;
revoke all on public.staff_bot_reports from anon, authenticated;
grant select, insert, update, delete on public.staff_bot_reports to service_role;

-- «الربط الخارجي»: what the staff bot now leans on in the two existing connections
update public.integrations set used_by = concat_ws('؛ ', used_by, 'بوت الموظفين: صياغة نصائح التقرير اليومي من أرقام الموظف فقط (بدون أسماء عملاء أو رسائل)'), updated_at = now()
 where check_key = 'openai' and coalesce(used_by, '') not like '%بوت الموظفين%';
update public.integrations set used_by = concat_ws('؛ ', used_by, 'بوت الموظفين: تنبيه التحويلات (webhook + فحص الدقيقة)، أرقام كل موظف، رسائل العميل والرد بتوكن الموظف نفسه، حالة الوصول'), updated_at = now()
 where check_key = 'teletel' and coalesce(used_by, '') not like '%بوت الموظفين%';
