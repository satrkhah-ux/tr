-- ============================================================================
-- 0098 — «العملاء»: the times its timing columns are computed from
--
-- The owner (2026-10-18): «تأخير أول رد», «كم احتاجت حتى أُسندت» and «كم الوقت
-- حتى استلمها الشخص الآخر» are computed, never typed — from the client's first
-- message, our first reply, the hand-over to another person and that person's
-- first reply. The Teletel pull writes them (teletel-pull.ts); a hand-over made
-- on the page stamps its own time. The contact ties a conversation to the
-- client's earlier ones («عميل سابق»). Idempotent.
-- ============================================================================

alter table public.client_leads
  add column if not exists first_message_at timestamptz,
  add column if not exists first_reply_at timestamptz,
  add column if not exists assigned_at timestamptz,
  add column if not exists assignee_reply_at timestamptz,
  add column if not exists contact_id bigint;

-- a Teletel row's created_at IS the conversation's first message
update public.client_leads set first_message_at = created_at where source = 'teletel' and first_message_at is null;

notify pgrst, 'reload schema';

-- ROLLBACK (manual):
-- alter table public.client_leads drop column if exists contact_id, drop column if exists assignee_reply_at,
--   drop column if exists assigned_at, drop column if exists first_reply_at, drop column if exists first_message_at;
