-- «تنبيهاتي» — one thing at a time, and the official letters (the owner, 2026-10-23).
--
-- staff_bot_slots — every message the bot posted, by what it is about: «view»
--                   (what the employee opened last), «conv:<id>» (one message per
--                   client), «report», «admin», «screen», «letter:<n>»… Posting into
--                   a slot deletes what was there before («عندما يبدأ شيء جديد تنحذف
--                   الرسائل السابقة كي لا يكون متداخلاً»).
-- staff_letters   — «الخطاب الرسمي» numbered per employee: 1 when the whole sales
--                   team has joined the bot, 2 ten days later comparing the two.
--                   signed_at is the employee's «✍️ اعتمدت الخطاب», their
--                   electronic signature.

create table if not exists public.staff_bot_slots (
  chat_id bigint not null,
  message_id bigint not null,
  slot text not null,
  created_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);
create index if not exists staff_bot_slots_chat_slot on public.staff_bot_slots (chat_id, slot);

create table if not exists public.staff_letters (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  number int not null check (number in (1, 2)),
  numbers jsonb not null,
  warned boolean not null default false,
  issued_at timestamptz not null default now(),
  chat_id bigint,
  message_id bigint,
  delivered boolean not null default false,
  signed_at timestamptz,
  unique (employee_id, number)
);

alter table public.staff_bot_slots enable row level security;
alter table public.staff_letters enable row level security;
revoke all on public.staff_bot_slots, public.staff_letters from anon, authenticated;
grant select, insert, update, delete on public.staff_bot_slots, public.staff_letters to service_role;
