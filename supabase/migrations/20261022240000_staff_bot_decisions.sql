-- «تنبيهاتي» — «قرارات الإدارة» in the bot (the user, 2026-10-22: «اريد اضافة
-- للإدارة في البوت قرارات الادارة التي تظهر على الشاشة و تطلب تدخل»).
--
-- staff_bot_signal_alerts   — each red item of «قناة المدير» («يحتاج تدخلك الآن»)
--                             pushed to the bot's managers once a Riyadh day.
-- staff_bot_decision_drafts — a decision being made in the chat: the item it came
--                             from, the text, then the owner, then the date. Nothing
--                             reaches management_decisions before the last step.
-- staff_bot_decision_sent   — each decision announced to its owner once, whether it
--                             was made in the bot or on «قرارات الإدارة».

create table if not exists public.staff_bot_signal_alerts (
  day date not null,
  signal_key text not null,
  created_at timestamptz not null default now(),
  primary key (day, signal_key)
);

create table if not exists public.staff_bot_decision_drafts (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  chat_id bigint not null,
  source_key text,
  title text,
  owner_id uuid references public.employees (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_bot_decision_sent (
  decision_id uuid primary key references public.management_decisions (id) on delete cascade,
  sent_at timestamptz not null default now()
);

alter table public.staff_bot_signal_alerts enable row level security;
alter table public.staff_bot_decision_drafts enable row level security;
alter table public.staff_bot_decision_sent enable row level security;
revoke all on public.staff_bot_signal_alerts, public.staff_bot_decision_drafts, public.staff_bot_decision_sent from anon, authenticated;
grant select, insert, update, delete on public.staff_bot_signal_alerts, public.staff_bot_decision_drafts, public.staff_bot_decision_sent to service_role;

-- the pending prompt may now also be a decision's text
alter table public.staff_bot_pending drop constraint if exists staff_bot_pending_kind_check;
alter table public.staff_bot_pending add constraint staff_bot_pending_kind_check check (kind in ('broadcast', 'alert', 'decision'));
alter table public.staff_bot_pending add column if not exists source_key text;
