-- ============================================================================
-- 0105 — «المستقبل الآلي»: how long Murad waited before answering
--
-- The owner (2026-10-18): «هل ممكن أن نضع تأخير بشري؟ ليس الرد بسرعة فائقة» —
-- Murad answers after a random 20–60 seconds (reception.ts parseDelay). The
-- conversation's row in «العملاء» keeps the seconds from the client's first
-- message of that burst to the answer, beside where it was sent. Idempotent.
-- ============================================================================

alter table public.client_leads add column if not exists auto_wait_sec int;

notify pgrst, 'reload schema';

-- ROLLBACK (manual): alter table public.client_leads drop column if exists auto_wait_sec;
