-- «تنبيهاتي» stage c (the owner, 2026-10-22): the client's messages reach the
-- employee's Telegram, and the employee answers from there. The answer goes into
-- the Teletel conversation AS THEM (their own Teletel access token), and the
-- bot then says whether WhatsApp delivered it and whether the client read it.
--
-- staff_bot_threads    — which Telegram message is about which conversation, so a
--                        Telegram «reply» to it is a reply to that client.
-- staff_bot_replies    — every reply sent from the bot: who, to which conversation,
--                        Teletel's message id, and its WhatsApp status. It is the
--                        record of the send, and the status edits the employee's
--                        confirmation in place.
-- staff_teletel_tokens — an employee's own Teletel access token, AES-256-GCM
--                        (SETTINGS_ENCRYPTION_KEY). It is checked to belong to their
--                        agent before it is stored. Service role only.

create table if not exists public.staff_bot_threads (
  chat_id bigint not null,
  message_id integer not null,
  conversation_id integer not null,
  created_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

create table if not exists public.staff_bot_replies (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  conversation_id integer not null,
  teletel_message_id integer,
  chat_id bigint not null,
  tg_message_id integer,
  content text not null,
  status text not null default 'sent' check (status in ('sent', 'delivered', 'read', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists staff_bot_replies_message on public.staff_bot_replies (teletel_message_id);
create index if not exists staff_bot_replies_open on public.staff_bot_replies (created_at desc) where status in ('sent', 'delivered');

create table if not exists public.staff_teletel_tokens (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  token_enc text not null,
  agent_id integer not null,
  linked_at timestamptz not null default now()
);

alter table public.staff_bot_threads enable row level security;
alter table public.staff_bot_replies enable row level security;
alter table public.staff_teletel_tokens enable row level security;
revoke all on public.staff_bot_threads, public.staff_bot_replies, public.staff_teletel_tokens from anon, authenticated;
grant select, insert, update, delete on public.staff_bot_threads, public.staff_bot_replies, public.staff_teletel_tokens to service_role;
