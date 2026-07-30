-- ============================================================================
-- 0029 — whether a file carries a price belongs to the FILE, not to the company
--
-- It was a per-company setting, which was the wrong shape twice over: the same
-- reseller may want a priced file for one client and a bare programme for the
-- next, and the person deciding is the one exporting — at the moment they export.
-- So the flag moves onto the offer, where the export screen writes it and the
-- client link reads it.
-- ============================================================================

-- Defaults true: a direct sale prints its price, which is every existing offer.
-- Producing a file FOR a partner writes false (see produceOfferFromDraft), so a
-- reseller's document does not start out quoting our number.
alter table public.offers add column if not exists show_prices boolean not null default true;

-- The company-level setting is gone rather than left to rot: nothing reads it
-- after this migration, and a stale toggle in an admin screen is worse than no
-- toggle — someone will set it and expect it to matter.
alter table public.booking_partners drop column if exists show_prices;
