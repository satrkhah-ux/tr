-- Legacy import, step 2: REFERENCE DATA — the lists every generator screen
-- depends on (countries, cities, hotels, room types, airports, transport
-- prices, terms). Without these the system runs on demo rows.
--
-- MERGE, not replace. Our own seeded rows were curated by hand — countries carry
-- iso2/timezone/visa flags and airports carry verified IATA + IANA zones that the
-- flight-duration engine needs, and the legacy tables have NEITHER. So a legacy
-- row is inserted only when its name is not already present; ours always wins.
--
-- Idempotent throughout: public.legacy_id_map guards every insert, so re-running
-- adds nothing. Order matters — cities need countries, hotels need cities.

begin;

-- Names in the old system carry stray whitespace and \r\n; compare on a
-- normalised form so "جدة " and "جدة" are recognised as the same place.
create or replace function pg_temp.norm(txt text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(regexp_replace(coalesce(txt, ''), '\s+', ' ', 'g'))), '');
$$;

-- ---------- 1. countries  <- legacy_sys.app_states ----------
with fresh as (
  select
    s.stateid as legacy_id,
    gen_random_uuid() as new_id,
    btrim(s.namearabic) as arabic_name,
    nullif(btrim(coalesce(s.nameenglish, '')), '') as english_name,
    nullif(btrim(coalesce(s.shortname, '')), '') as code,
    nullif(btrim(coalesce(s.currency, '')), '') as default_currency
  from legacy_sys.app_states s
  where coalesce(btrim(s.namearabic), '') <> ''
    and not exists (
      select 1 from public.legacy_id_map m
      where m.entity = 'country' and m.source = 'sys' and m.legacy_id = s.stateid
    )
    and not exists (
      select 1 from public.countries c
      where pg_temp.norm(c.arabic_name) = pg_temp.norm(s.namearabic)
    )
),
ins as (
  insert into public.countries (id, arabic_name, english_name, code, default_currency)
  select new_id, arabic_name, english_name, code, default_currency from fresh
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'country', 'sys', legacy_id, new_id from fresh;

-- Countries that already existed under the same name still need a mapping, or
-- their cities below would be orphaned.
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'country', 'sys', s.stateid, c.id
from legacy_sys.app_states s
join public.countries c on pg_temp.norm(c.arabic_name) = pg_temp.norm(s.namearabic)
where not exists (
  select 1 from public.legacy_id_map m
  where m.entity = 'country' and m.source = 'sys' and m.legacy_id = s.stateid
)
on conflict do nothing;

-- ---------- 2. cities  <- legacy_sys.app_cities ----------
with fresh as (
  select
    ct.cityid as legacy_id,
    gen_random_uuid() as new_id,
    btrim(ct.cityname) as arabic_name,
    nullif(btrim(coalesce(ct.citynameenglish, '')), '') as english_name,
    (select m.new_id from public.legacy_id_map m
      where m.entity = 'country' and m.source = 'sys' and m.legacy_id = ct.stateid) as country_id
  from legacy_sys.app_cities ct
  where coalesce(btrim(ct.cityname), '') <> ''
    and not exists (
      select 1 from public.legacy_id_map m
      where m.entity = 'city' and m.source = 'sys' and m.legacy_id = ct.cityid
    )
    and not exists (
      select 1 from public.cities c
      where pg_temp.norm(c.arabic_name) = pg_temp.norm(ct.cityname)
    )
),
ins as (
  insert into public.cities (id, arabic_name, english_name, country_id)
  select new_id, arabic_name, english_name, country_id from fresh
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'city', 'sys', legacy_id, new_id from fresh;

insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'city', 'sys', ct.cityid, c.id
from legacy_sys.app_cities ct
join public.cities c on pg_temp.norm(c.arabic_name) = pg_temp.norm(ct.cityname)
where not exists (
  select 1 from public.legacy_id_map m
  where m.entity = 'city' and m.source = 'sys' and m.legacy_id = ct.cityid
)
on conflict do nothing;

-- ---------- 3. hotels  <- legacy_sys.app_hotels ----------
-- Hotel names repeat across cities (every chain has a "هيلتون"), so the
-- duplicate check is name + city, not name alone.
with fresh as (
  select distinct on (pg_temp.norm(h.hotelname), h.cityid)
    h.hotelid as legacy_id,
    gen_random_uuid() as new_id,
    btrim(h.hotelname) as arabic_name,
    nullif(btrim(coalesce(h.hotelnameenglish, '')), '') as english_name,
    nullif(btrim(coalesce(h.hotellocation, '')), '') as address,
    case when h.hotelstar between 1 and 7 then h.hotelstar end as stars,
    (select m.new_id from public.legacy_id_map m
      where m.entity = 'city' and m.source = 'sys' and m.legacy_id = h.cityid) as city_id,
    (select m.new_id from public.legacy_id_map m
      where m.entity = 'country' and m.source = 'sys' and m.legacy_id = h.stateid) as country_id
  from legacy_sys.app_hotels h
  where coalesce(btrim(h.hotelname), '') <> ''
    and not exists (
      select 1 from public.legacy_id_map m
      where m.entity = 'hotel' and m.source = 'sys' and m.legacy_id = h.hotelid
    )
  order by pg_temp.norm(h.hotelname), h.cityid, h.hotelid
),
deduped as (
  select f.* from fresh f
  where not exists (
    select 1 from public.hotels ph
    where pg_temp.norm(ph.arabic_name) = pg_temp.norm(f.arabic_name)
      and ph.city_id is not distinct from f.city_id
  )
),
ins as (
  insert into public.hotels (id, arabic_name, english_name, address, stars, city_id, country_id)
  select new_id, arabic_name, english_name, address, stars, city_id, country_id from deduped
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'hotel', 'sys', legacy_id, new_id from deduped;

-- ---------- 4. terms  <- legacy_sys.app_conditions ----------
-- The old text is stored with literal \r\n; collapse it so it prints cleanly in
-- the offer document instead of showing escape characters.
with fresh as (
  select
    c.conditionid as legacy_id,
    gen_random_uuid() as new_id,
    btrim(regexp_replace(regexp_replace(c.conditionname, '\\r\\n|\r\n|\r', ' ', 'g'), '\s+', ' ', 'g')) as arabic_text
  from legacy_sys.app_conditions c
  where coalesce(btrim(c.conditionname), '') <> ''
    and not exists (
      select 1 from public.legacy_id_map m
      where m.entity = 'term' and m.source = 'sys' and m.legacy_id = c.conditionid
    )
),
deduped as (
  select f.* from fresh f
  where f.arabic_text <> ''
    and not exists (
      select 1 from public.terms t
      where t.kind = 'term' and pg_temp.norm(t.arabic_text) = pg_temp.norm(f.arabic_text)
    )
),
ins as (
  insert into public.terms (id, kind, arabic_text, checked, sort)
  select new_id, 'term', arabic_text, true, 100 from deduped
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'term', 'sys', legacy_id, new_id from deduped;

-- ---------- 5. airports  <- legacy_sys.app_airports ----------
-- NOTE: the legacy rows have NO IATA code and NO timezone (airportlocation is a
-- street address). Ours do, and the flight-duration engine needs them — so we
-- only ADD names we don't already have, and the new rows land without a code.
-- The generator already guards this: a leg whose airports have no zone shows
-- "duration needs airports" rather than guessing.
with fresh as (
  select distinct on (pg_temp.norm(a.airportname))
    a.airportid as legacy_id,
    gen_random_uuid() as new_id,
    btrim(a.airportname) as arabic_name,
    nullif(btrim(coalesce(a.airportnameenglish, '')), '') as english_name,
    (select m.new_id from public.legacy_id_map m
      where m.entity = 'city' and m.source = 'sys' and m.legacy_id = a.cityid) as city_id,
    (select m.new_id from public.legacy_id_map m
      where m.entity = 'country' and m.source = 'sys' and m.legacy_id = a.stateid) as country_id
  from legacy_sys.app_airports a
  where coalesce(btrim(a.airportname), '') <> ''
    and not exists (
      select 1 from public.legacy_id_map m
      where m.entity = 'airport' and m.source = 'sys' and m.legacy_id = a.airportid
    )
  order by pg_temp.norm(a.airportname), a.airportid
),
deduped as (
  select f.* from fresh f
  where not exists (
    select 1 from public.airports pa
    where pg_temp.norm(pa.arabic_name) = pg_temp.norm(f.arabic_name)
  )
),
ins as (
  insert into public.airports (id, arabic_name, english_name, city_id, country_id, status)
  select new_id, arabic_name, english_name, city_id, country_id, 'Active' from deduped
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'airport', 'sys', legacy_id, new_id from deduped;

commit;
