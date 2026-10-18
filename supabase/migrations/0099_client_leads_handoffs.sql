-- ============================================================================
-- 0099 — «العملاء»: who received a conversation first, and every hand-over
--
-- The owner (2026-10-18): «الموظف المستلم» is the one who received it FIRST,
-- not whoever holds it now — and for each employee how long they took to
-- answer, how long before they handed it on, and how long the next one took.
-- The Teletel pull reads the conversation's history (its «تم إسنادها إلى …»
-- lines and the replies) into `handoffs`: one stage per agent, in order —
-- {agent, from, reply, handed, by} in epoch seconds. `timeline_seen_at` is
-- the conversation's last activity when it was read, so it is read again only
-- once something new happened. Idempotent.
-- ============================================================================

alter table public.client_leads
  add column if not exists handoffs jsonb,
  add column if not exists timeline_seen_at bigint;

notify pgrst, 'reload schema';

-- ROLLBACK (manual):
-- alter table public.client_leads drop column if exists timeline_seen_at, drop column if exists handoffs;
