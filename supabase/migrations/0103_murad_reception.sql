-- ============================================================================
-- 0103 — «المستقبل الآلي»: Murad receives a new conversation the moment it
-- arrives (the owner, 2026-10-18)
--
-- The Teletel webhook (message_created) hands each incoming message to
-- src/lib/murad/reception.ts: a greeting by name, «سيتم تحويل طلبك إلى قسم …»,
-- and the conversation assigned to that department's Teletel team — once, on a
-- new conversation, while no colleague has answered. Its turns are logged in
-- murad_log as mode 'reception'; the conversation's row in «العملاء» carries
-- where it was sent and when. Idempotent.
-- ============================================================================

alter table public.murad_log drop constraint if exists murad_log_mode_check;
alter table public.murad_log add constraint murad_log_mode_check check (mode in ('auto', 'suggest', 'skipped', 'reception'));

alter table public.client_leads
  add column if not exists auto_route text,
  add column if not exists auto_routed_at timestamptz;

notify pgrst, 'reload schema';

-- ROLLBACK (manual):
-- alter table public.client_leads drop column if exists auto_routed_at, drop column if exists auto_route;
-- delete from public.murad_log where mode = 'reception';
-- alter table public.murad_log drop constraint if exists murad_log_mode_check;
-- alter table public.murad_log add constraint murad_log_mode_check check (mode in ('auto', 'suggest', 'skipped'));
