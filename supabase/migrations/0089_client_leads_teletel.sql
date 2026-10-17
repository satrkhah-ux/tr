-- ============================================================================
-- 0089 — «العملاء» phase two: the conversations straight from Teletel
--
-- The owner (2026-10-17): «كل شيء تلقائي، خاصة اسم العميل». Each WhatsApp
-- conversation in Teletel becomes one client_leads row, keyed by its Teletel id:
-- the client's name and phone, the agent holding it, its real date, open or
-- resolved, the kind and the place read from its labels and words. A sheet row
-- for the same phone is merged into it rather than counted twice.
-- Idempotent.
-- ============================================================================

alter table public.client_leads
  add column if not exists teletel_conversation_id bigint unique;

alter table public.client_leads drop constraint if exists client_leads_source_check;
alter table public.client_leads
  add constraint client_leads_source_check check (source in ('manual', 'sheet', 'teletel'));
