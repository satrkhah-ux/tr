-- ============================================================================
-- 0095 — transfers.provisional: a price put in to unblock the generator, not
-- one a supplier gave.
--
-- The owner (2026-10-18): «ضعها الآن جميعها 100 ريال للتوصيلات في المدن غير
-- الموجودة» — every city whose airport transfer has no price for «سيارة صغيرة»
-- gets 100 SAR (reception; the farewell reads the reception line), marked as
-- provisional until the real price is entered. Existing prices are untouched.
-- The marker lets the data team find them (where provisional) and replace them;
-- the generator does not read it. Idempotent.
-- ============================================================================

alter table public.transfers add column if not exists provisional boolean not null default false;
comment on column public.transfers.provisional is
  'A placeholder price (owner, 2026-10-18: 100 SAR small-car airport transfers), to be replaced by a real one (0095).';

notify pgrst, 'reload schema';

-- ROLLBACK (manual): alter table public.transfers drop column if exists provisional;
