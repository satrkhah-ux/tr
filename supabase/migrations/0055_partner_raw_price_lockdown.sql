-- App Travluin — a partner reads our prices only at THEIR terms, never raw.
--
-- The owner's decision (2026-10-13): partner companies may see prices, but every
-- price a partner sees carries that company's terms — booking_partners
-- .price_adjust_kind ('markup' | 'commission') and .price_adjust_pct, applied by
-- partnerPrice() in src/lib/partners/pricing.ts. A partner on markup 10% sees
-- our 1,000 as 1,100; nobody outside the building sees the 1,000.
--
-- That rule lives in the server, and a direct read skips the server. 0036 gave
-- partners whole-row SELECT on the catalogue so the generator's dropdowns would
-- fill, and four of those tables carry money; 0037 did the same for our ready
-- packages. A partner's own token, sent straight to PostgREST, reads:
--   tours.price, transfers.price         what we PAY (649 + 482 rows)
--   services.sell_price                  our sell (buy_price was revoked in 0047)
--   transportation_types.sell_price      our sell, once staff fill it in
--   ready_offers.price, seed.pricing     our package price
-- RLS filters rows, not columns, and these grants are to `authenticated`, the
-- role staff share — so the policies go, and the app reads these tables for a
-- partner through the service role and quotes them through partnerPrice:
--   pricing suggestions   src/lib/data/pricing-suggest.ts  (partnerSheet)
--   generator dropdowns   src/lib/data/drafts.ts getGeneratorLookups (names only)
--   ready offers          src/lib/data/ready-offers.ts     (same filter as below)
--
-- Staff are untouched: their access is each table's is_staff() policy, and
-- current_partner_id() is null in every staff session, so the dropped policies
-- never contributed a row to staff. No column grant changes.
--
-- KEPT on purpose (each read by the partner app, and none a raw price list):
--   offers / offer_hotels / operations / operation_payments / operation_bookings
--     — the partner's OWN files. The last four test ownership with a subquery on
--     offers under the caller's RLS, so dropping offers_partner_read would blank
--     them all. What those rows hold is what the producer stores, and quoting
--     an issued partner file at their terms is the producer's job, not RLS's:
--     a partner's OWN file is issued at their terms (produceOfferFromDraft). A
--     file staff build FOR a partner company still stores our sell in
--     offers.total and offer_hotels.sell_price — open, for the owner to decide.
--   booking_partners_self — their own terms, shown on /b2b/profile.
--   every price-free catalogue policy from 0036 (countries, cities, hotels, …).
--
-- To verify after applying: in a rolled-back transaction, `set local role
-- authenticated` with a partner's request.jwt.claims — these five tables return
-- 0 rows; a staff session's counts are unchanged.

drop policy if exists tours_partner_read                on public.tours;
drop policy if exists transfers_partner_read            on public.transfers;
drop policy if exists services_partner_read             on public.services;
drop policy if exists transportation_types_partner_read on public.transportation_types;
drop policy if exists ready_offers_partner_read         on public.ready_offers;

notify pgrst, 'reload schema';
