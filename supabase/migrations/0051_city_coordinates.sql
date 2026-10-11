-- Where each city is, so the day-by-day weather can be looked up by position.
--
-- The weather used to geocode the city's ARABIC name on every request, and the
-- geocoder knows almost none of them: «سيلانجور», «لنكاوي» and «بينانج» all came
-- back empty, so a Malaysia programme printed weather for Kuala Lumpur only.
-- Filled once by scripts/fill-city-coords.mjs (English name + country, ranked),
-- and by the weather lookup itself the first time it resolves a city.

alter table public.cities add column if not exists lat numeric(9, 6);
alter table public.cities add column if not exists lng numeric(9, 6);
