-- «تنبيهاتي»: «📢 إعلان عام», «🖥️ شاشتي» and the waiting reminders.
--
-- «📢 إعلان عام» (the owner, 2026-10-22, item 7: «أمر يرسل منه
-- المدير تنبيهاً أو إعلاناً عاماً لكل الموظفين المربوطين بالبوت»).
--
-- The administration (employees.manage) writes an announcement in the bot,
-- sees it as it will arrive, and confirms. It then reaches every active employee
-- whose Telegram is linked. One row per announcement, created as a draft at the
-- preview. Moving draft → sending is the one claim, so a double tap on «إرسال»
-- sends once. It is also the record: who said what, to how many, and how many
-- it reached.

create table if not exists public.staff_bot_broadcasts (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.employees (id) on delete cascade,
  content text not null check (length(content) between 1 and 3500),
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'cancelled')),
  recipients integer,
  delivered integer,
  not_delivered text[],
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.staff_bot_broadcasts enable row level security;
revoke all on public.staff_bot_broadcasts from anon, authenticated;
grant select, insert, update, delete on public.staff_bot_broadcasts to service_role;

-- «🖥️ شاشتي» (the user, 2026-10-22: «يكون البوت كشاشة موظف يراقب اداءه
-- بالكامل»): each employee's own live screen, one pinned message the minute job
-- edits every five minutes. One row per employee, holding the message being kept
-- up to date. Opening the screen again moves the row to the new message.
create table if not exists public.staff_bot_screens (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  chat_id bigint not null,
  message_id integer not null,
  updated_at timestamptz not null default now()
);

-- «⏰ ينتظر ردك»: one reminder per waiting episode and level (15 and 60 minutes).
-- A new client message starts a new episode (a new waiting_since), so a
-- conversation answered and waiting again is reminded again, but never twice for
-- the same wait.
create table if not exists public.staff_bot_reminders (
  conversation_id integer not null,
  waiting_since bigint not null,
  level smallint not null,
  created_at timestamptz not null default now(),
  primary key (conversation_id, waiting_since, level)
);

alter table public.staff_bot_screens enable row level security;
alter table public.staff_bot_reminders enable row level security;
revoke all on public.staff_bot_screens, public.staff_bot_reminders from anon, authenticated;
grant select, insert, update, delete on public.staff_bot_screens, public.staff_bot_reminders to service_role;
