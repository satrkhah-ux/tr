-- «تنبيهاتي - ترافليون» (@traveliunbot), the staff bot (the owner, 2026-10-22,
-- order 1 of 3). Stage a: who is who, and where the bot's token lives.
--
-- employees.teletel_agent_id — the employee's agent in Teletel
-- (chat.teletel.io). It is matched by email, then by exact name, from
-- /assignable_agents. The bot routes assignment events and the counts by it,
-- and orders 2 and 3 read it. A Teletel agent belongs to one employee at most.
--
-- bot_credentials — a bot's token, AES-256-GCM under SETTINGS_ENCRYPTION_KEY
-- (lib/crypto/secrets.ts). The developer replaces it on «المطوّر» with no
-- deploy, and env TELEGRAM_STAFF_BOT_TOKEN is the fallback. Only the service
-- role can read it, because app_settings is readable by every staff session.

alter table public.employees add column if not exists teletel_agent_id integer;
create unique index if not exists employees_teletel_agent_id_key on public.employees (teletel_agent_id);

create table if not exists public.bot_credentials (
  bot text primary key,
  token_enc text not null,
  username text,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.bot_credentials enable row level security;
revoke all on public.bot_credentials from anon, authenticated;
grant select, insert, update, delete on public.bot_credentials to service_role;

insert into public.integrations (name, kind, used_by, secret_ref, account, check_key, notes)
select
  '@traveliunbot — تنبيهاتي (الموظفين)',
  'bot',
  'كل موظف على حسابه في تيليجرام: تنبيه بكل محادثة تُسند إليه في تيلي تيل، أرقامه، الرد على العميل، والتقرير اليومي',
  'مشفّر في النظام (bot_credentials، المفتاح SETTINGS_ENCRYPTION_KEY) — احتياطي: TELEGRAM_STAFF_BOT_TOKEN',
  'BotFather — حساب المالك',
  'bot_staff',
  'يُستبدل التوكن من «المطوّر» ← بوت الموظفين، ويُعاد تسجيل الـ webhook تلقائياً'
where not exists (select 1 from public.integrations where check_key = 'bot_staff');
