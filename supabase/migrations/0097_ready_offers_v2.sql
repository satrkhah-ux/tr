-- ============================================================================
-- 0097 — «العروض الجاهزة» from the owner's new sheet (2026-10-18)
--
-- The new sheet has two tabs (a summary and the details) and no economy /
-- premium tiers. It says who the price is for («سعر إجمالي لشخصين بالغين»),
-- whether an offer is published («ملاحظات = لم يتم النشر»), and where its two
-- tabs disagree the offer is imported with the reasons and cannot start a file
-- until the sheet is corrected (the owner: «اجعلها ظاهرة بها خطأ في النظام حتى
-- يتم تصحيحها من الورقة الأساسية»). Idempotent.
-- ============================================================================

alter table public.ready_offers
  add column if not exists published boolean not null default true,
  -- the reasons the sheet contradicts itself; empty = none. A row with any is shown, red, and starts nothing.
  add column if not exists problems text[] not null default '{}',
  -- «أساس التسعير» as written, and the party it prices
  add column if not exists price_basis text,
  add column if not exists adults int,
  add column if not exists children int,
  -- «ملاحظات» as written
  add column if not exists notes text;

notify pgrst, 'reload schema';

-- ROLLBACK (manual):
-- alter table public.ready_offers drop column if exists notes, drop column if exists children,
--   drop column if exists adults, drop column if exists price_basis, drop column if exists problems,
--   drop column if exists published;
