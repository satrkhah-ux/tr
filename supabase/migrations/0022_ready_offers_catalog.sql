-- App Travluin — «العروض الجاهزة» becomes a real catalog.
--
-- `ready_offers` has existed since 0003 as a five-column placeholder behind the
-- nav item, seeded with four demo rows in 0007 and referenced by no code at all.
-- This turns it into the store for the company's prepared seasonal packages,
-- synced from marketing's Google Sheet: full package detail, the fixed selling
-- price, the season window, and a ready-to-use draft seed.
--
-- Idempotent; safe to re-run.

alter table public.ready_offers
  -- stable sync key: a fingerprint of the row identity. The sheet's own `#`
  -- column repeats and is blank on many rows, so it cannot be the key.
  add column if not exists code text,
  add column if not exists tier text,
  -- «الباقة المتوسطة» / «عرض مميز (جزيرة)» — Vietnam ships three variants.
  add column if not exists variant text,
  add column if not exists nights int,
  add column if not exists cities_summary text,
  add column if not exists main_hotels text,
  add column if not exists tours_text text,
  add column if not exists domestic_flight text,
  add column if not exists includes_text text,
  add column if not exists excludes_text text,
  -- the season as marketing wrote it, kept verbatim for display
  add column if not exists validity_raw text,
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  -- link to the package's design file in the shared Drive folder
  add column if not exists design_url text,
  -- 'ready' (priced, can seed a draft) | 'coming_soon' (announced, unpriced)
  add column if not exists status text not null default 'ready',
  -- rows dropped from the sheet are deactivated, never deleted: a live draft
  -- may still point at them.
  add column if not exists active boolean not null default true,
  -- Partial<DraftData> — what «ابدأ عرضًا من هذه الباقة» pours into a new draft.
  add column if not exists seed jsonb,
  -- the raw sheet row, for auditing a sync and diffing the next one
  add column if not exists source_row jsonb,
  add column if not exists synced_at timestamptz;

create unique index if not exists ready_offers_code_key
  on public.ready_offers (code)
  where code is not null;

create index if not exists ready_offers_active_tier_idx
  on public.ready_offers (active, tier);

-- Drop the four demo rows from 0007 (matched by title AND the absence of a sync
-- code, so a hand-entered row is never caught by this).
delete from public.ready_offers
where code is null
  and title in ('ماليزيا العائلية', 'تركيا الاقتصادية', 'تايلاند شهر العسل', 'بالي الرومانسية');

-- RLS already enabled with the `authenticated_all` policy in 0003; unchanged.
