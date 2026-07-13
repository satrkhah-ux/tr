-- App Travluin — supplier-sourcing + client-safety fields on offer hotel lines.
-- These carry the supplier rate a hotel line was priced from so the render
-- snapshot (offer_renders.snapshot_json) freezes a complete, reproducible audit
-- trail. The CLIENT-SAFE columns (cancellation_policy, excluded_surcharges,
-- valid_until) surface to the client document; the rest are INTERNAL cost basis
-- and are structurally stripped from the client DTO (src/lib/offer/dto.ts).
-- Idempotent; safe to re-run.

alter table public.offer_hotels
  -- client-safe
  add column if not exists cancellation_policy text,
  add column if not exists excluded_surcharges jsonb not null default '[]'::jsonb,
  add column if not exists valid_until date,
  -- INTERNAL supplier sourcing / cost basis
  add column if not exists supplier_id text,
  add column if not exists supplier_name text,
  add column if not exists rate_key text,
  add column if not exists net_base numeric(12, 2),
  add column if not exists net_source_currency text,
  add column if not exists fx_rate numeric(14, 6),
  add column if not exists fx_date date,
  add column if not exists ref_sell_base numeric(12, 2),
  add column if not exists markup_amount numeric(12, 2),
  add column if not exists markup_pct numeric(8, 2);
