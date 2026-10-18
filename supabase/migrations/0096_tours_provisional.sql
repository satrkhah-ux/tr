-- ============================================================================
-- 0096 — tours.provisional / tour_prices.provisional: a placeholder tour price
--
-- The owner (2026-10-18): «نظف الجولات وحدث الأسعار مؤقتة 100 ريال» — every
-- city programme with no price gets 100 SAR for «سيارة صغيرة», marked so the
-- data team can find (where provisional) and replace it. Same marker as
-- transfers (0095); the generator does not read it. Idempotent.
-- ============================================================================

alter table public.tours add column if not exists provisional boolean not null default false;
alter table public.tour_prices add column if not exists provisional boolean not null default false;
comment on column public.tours.provisional is 'A row made to carry a placeholder price for a city programme (owner, 2026-10-18), to be replaced (0096).';
comment on column public.tour_prices.provisional is 'A placeholder price (owner, 2026-10-18: 100 SAR small car), to be replaced (0096).';

notify pgrst, 'reload schema';

-- ROLLBACK (manual):
-- alter table public.tour_prices drop column if exists provisional;
-- alter table public.tours drop column if exists provisional;
