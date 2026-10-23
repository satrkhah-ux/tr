-- How a Saudi passport enters each country (the owner, 2026-10-23: «اسهل دولة» in
-- three parts — without a visa, a visa on arrival, an easy e-visa; only a country
-- that needs an application goes to the visa team). Null = not decided: Murad
-- then falls back to visa_required. Only the entries known for sure are filled;
-- the owner fills the rest on /countries.
alter table public.countries add column if not exists saudi_entry text
  check (saudi_entry in ('free', 'arrival', 'evisa', 'embassy'));

update public.countries set saudi_entry = 'free'
  where iso2 in ('AE', 'BH', 'KW', 'OM', 'QA', 'GE', 'TR', 'MY', 'MA', 'TN', 'JO', 'SG', 'HK', 'TH') and saudi_entry is null;
update public.countries set saudi_entry = 'arrival'
  where iso2 in ('MV', 'NP', 'ID', 'LB', 'SC', 'MU') and saudi_entry is null;
update public.countries set saudi_entry = 'evisa'
  where iso2 in ('IN', 'LK', 'KE', 'VN', 'GB', 'KR', 'RU') and saudi_entry is null;
update public.countries set saudi_entry = 'embassy'
  where iso2 in ('DE', 'ES', 'IT', 'PT', 'CZ', 'HU', 'AT', 'GR', 'PL', 'CH', 'NL', 'FR', 'US', 'CA', 'CY', 'ZA') and saudi_entry is null;
