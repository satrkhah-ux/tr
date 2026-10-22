-- «تنبيهاتي» for its managers (the user, 2026-10-22: «اعطهم صلاحيات الادارة
-- الكاملة للبوت و امكان متابعة الموظفين و كذلك ارسال اعلان للجميع وارسال تنبيه
-- للموظف»). The permission is staffbot.manage (lib/roles/roles.ts), or
-- employees.manage.
--
-- staff_bot_broadcasts.target_id — null means everyone (an announcement); an
-- employee means an alert to that one colleague. Same draft → preview → confirm,
-- and the same record.
--
-- staff_bot_pending — what a manager's NEXT text is for (an announcement, or an
-- alert to someone), set by the button and used once within ten minutes. It
-- turns that text into a draft, and nothing is sent before the preview is
-- confirmed.

alter table public.staff_bot_broadcasts add column if not exists target_id uuid references public.employees (id) on delete cascade;

create table if not exists public.staff_bot_pending (
  chat_id bigint primary key,
  kind text not null check (kind in ('broadcast', 'alert')),
  target_id uuid references public.employees (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.staff_bot_pending enable row level security;
revoke all on public.staff_bot_pending from anon, authenticated;
grant select, insert, update, delete on public.staff_bot_pending to service_role;
