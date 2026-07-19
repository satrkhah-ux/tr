-- App Travluin — Telegram Mini App linking.
-- Maps a Telegram user id to an employee so opening the Mini App signs the
-- employee in automatically (initData is verified server-side with the bot
-- token before this id is trusted). One Telegram account ↔ one employee.
-- Idempotent; safe to re-run.

alter table public.employees add column if not exists telegram_chat_id bigint;

create unique index if not exists employees_telegram_chat_id_key
  on public.employees (telegram_chat_id)
  where telegram_chat_id is not null;
