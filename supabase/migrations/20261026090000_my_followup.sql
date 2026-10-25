-- «متابعتي» (the owner, 2026-10-25): each employee follows up their own conversations.
--
--   my_followup_reminders — «ذكّرني بعد…» and personal reminders: due_at, done once,
--                           the bot's ping once (notified_at). A reminder on a conversation
--                           also hides its card until it is due.
--   my_followup_marks     — one row per employee and key:
--                             'c:<conversation id>'  «تمّت» (done_at: hidden until something new), the note,
--                                                    and the last ping about it (pinged_at, ping_reason)
--                             'day:<YYYY-MM-DD>'     the start-of-day list was sent (pinged_at)
--
-- Closed like the other staff tables: RLS on, no policy; only the service role reads
-- and writes, after the server checked who is asking (src/lib/data/my-followups.ts).

create table if not exists public.my_followup_reminders (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  conversation_id bigint,
  text text not null default '' check (length(text) <= 500),
  due_at timestamptz not null,
  done_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists my_followup_reminders_open on public.my_followup_reminders (employee_id, due_at) where done_at is null;

create table if not exists public.my_followup_marks (
  employee_id uuid not null references public.employees (id) on delete cascade,
  key text not null check (key ~ '^(c:\d+|day:\d{4}-\d{2}-\d{2})$'),
  done_at timestamptz,
  note text check (note is null or length(note) <= 1000),
  pinged_at timestamptz,
  ping_reason text,
  updated_at timestamptz not null default now(),
  primary key (employee_id, key)
);

alter table public.my_followup_reminders enable row level security;
alter table public.my_followup_marks enable row level security;
revoke all on public.my_followup_reminders, public.my_followup_marks from anon, authenticated;
grant select, insert, update, delete on public.my_followup_reminders, public.my_followup_marks to service_role;
grant usage on sequence public.my_followup_reminders_id_seq to service_role;
