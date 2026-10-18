-- ============================================================================
-- 0104 — «العملاء»: a client writing again is a request again
--
-- WhatsApp reopens a client's old Teletel conversation when they write days
-- later, so one row per conversation counted that request on the day the
-- conversation first opened — about one request in ten went uncounted in
-- «طلبات اليوم» (the owner's daily tally, 2026-10-18). `last_visit_at` is when
-- the client came back: the conversation had been closed, or their message
-- came more than 24 hours after the visit before (the owner's own rule for
-- «عميل سابق»). The pull and «المستقبل الآلي» set it; the page counts a row on
-- the day it opened and on the day of its latest visit. Idempotent.
-- ============================================================================

alter table public.client_leads add column if not exists last_visit_at timestamptz;

notify pgrst, 'reload schema';

-- ROLLBACK (manual): alter table public.client_leads drop column if exists last_visit_at;
