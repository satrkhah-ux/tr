-- «يشمل / لا يشمل» and «الشروط» per country.
--
-- The terms library was one global list, so every file carried every
-- country's lines and the agent deleted the wrong ones by hand. A row with a
-- country_id is offered only for that country; NULL stays global — which is
-- what the existing rows are, so nothing changes until the admin adds rows
-- for a country.

alter table public.terms
  add column if not exists country_id uuid references public.countries (id) on delete cascade;

create index if not exists terms_country_id_idx on public.terms (country_id);
