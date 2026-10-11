-- The exchange rates an offer was issued with, and its total in SAR.
--
-- Issuing converts every pricing line into the quote currency. The rates it
-- used have to travel with the offer: recomputed later at that day's rates, an
-- issued file's internal figures would drift daily. total_sar lets the KPIs
-- add up offers quoted in different currencies.

alter table public.pricings
  add column if not exists fx_rates jsonb,
  add column if not exists fx_source text,
  add column if not exists fx_date timestamptz;

alter table public.offers
  add column if not exists total_sar numeric(14, 2);

-- pricings has column-level SELECT since 0039 (buy_total and profit withheld),
-- so a new column is invisible to staff until granted by name. Exchange rates
-- are not internal figures; nothing withheld in 0039 is re-opened here.
grant select (fx_rates, fx_source, fx_date) on public.pricings to authenticated;

-- One legacy row in each table spelled the currency out. ISO codes only, or a
-- converter looks up «ريال سعودي» and finds no rate.
update public.offers set currency = 'SAR' where currency = 'ريال سعودي';
update public.pricings set currency = 'SAR' where currency = 'ريال سعودي';
update public.transfers set currency = 'SAR' where currency = 'ريال سعودي';
