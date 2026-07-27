-- Legacy import, step 3: the PRICED lists — transport prices, room types and
-- services. These drive the transport/hotels/services stages of the generator.
--
-- Source is legacy_app (the newer system) because only it carries prices per
-- car type and per currency; legacy_sys stored a single price on the car row.
--
-- ⚠️ buy_price is INTERNAL. public.services keeps buy and sell in separate
-- columns and the client DTO strips the buy side structurally (see lib/offer/
-- dto.ts) — so copying it here is safe, but it must never be surfaced to a
-- client-facing view.
--
-- Idempotent via public.legacy_id_map, same as the earlier steps.

begin;

create or replace function pg_temp.norm(txt text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(regexp_replace(coalesce(txt, ''), '\s+', ' ', 'g'))), '');
$$;

-- ---------- 1. transport prices  <- transfer_cars_prices x transfers x cars_types ----------
-- One row per (route, car type). Our transfers table stores the endpoints as
-- TEXT, so no city FK is needed — but country_id is resolved through the city
-- name so the transport stage can filter by destination.
with priced as (
  select
    p.id as legacy_id,
    gen_random_uuid() as new_id,
    coalesce(
      nullif(btrim(t.point_1_arabic_name), ''),
      nullif(btrim(t.point_1_english_name), '')
    ) as from_city,
    coalesce(
      nullif(btrim(t.point_2_arabic_name), ''),
      nullif(btrim(t.point_2_english_name), '')
    ) as to_city,
    coalesce(nullif(btrim(ct.arabic_name), ''), nullif(btrim(ct.english_name), '')) as car_type,
    p.price::numeric(12, 2) as price,
    nullif(btrim(coalesce(cu.iso_code, '')), '') as currency,
    (
      select pc.country_id
      from legacy_app.cities lc
      join public.cities pc on pg_temp.norm(pc.arabic_name) = pg_temp.norm(lc.arabic_name)
      where lc.id = t.point_1_city
      limit 1
    ) as country_id
  from legacy_app.transfer_cars_prices p
  join legacy_app.transfers t on t.id = p.transfer_id
  left join legacy_app.cars_types ct on ct.id = p.car_type_id
  left join legacy_app.currencies cu on cu.id = p.currency_id
  where coalesce(p.status, true)
    and not exists (
      select 1 from public.legacy_id_map m
      where m.entity = 'transfer' and m.source = 'app' and m.legacy_id = p.id
    )
),
fresh as (
  select * from priced
  where from_city is not null and to_city is not null and price is not null
),
ins as (
  insert into public.transfers (id, from_city, to_city, car_type, price, currency, country_id)
  select new_id, from_city, to_city, car_type, price, currency, country_id from fresh
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'transfer', 'app', legacy_id, new_id from fresh;

-- ---------- 2. room types  <- legacy_app.rooms_types ----------
-- The old table holds one row per hotel-room combination, so the same name
-- repeats hundreds of times. Ours are generic (hotel_id null), so collapse to
-- distinct names.
with fresh as (
  select distinct on (pg_temp.norm(r.arabic_name))
    r.id as legacy_id,
    gen_random_uuid() as new_id,
    btrim(r.arabic_name) as arabic_name,
    nullif(btrim(coalesce(r.english_name, '')), '') as english_name
  from legacy_app.rooms_types r
  where coalesce(btrim(r.arabic_name), '') <> ''
    and coalesce(r.status, true)
    and not exists (
      select 1 from public.legacy_id_map m
      where m.entity = 'room_type' and m.source = 'app' and m.legacy_id = r.id
    )
  order by pg_temp.norm(r.arabic_name), r.id
),
deduped as (
  select f.* from fresh f
  where not exists (
    select 1 from public.room_types rt
    where pg_temp.norm(rt.arabic_name) = pg_temp.norm(f.arabic_name)
      and rt.hotel_id is null
  )
),
ins as (
  insert into public.room_types (id, arabic_name, english_name)
  select new_id, arabic_name, english_name from deduped
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'room_type', 'app', legacy_id, new_id from deduped;

-- ---------- 3. services  <- legacy_app.services x services_types ----------
with fresh as (
  select
    s.id as legacy_id,
    gen_random_uuid() as new_id,
    coalesce(nullif(btrim(st.arabic_name), ''), nullif(btrim(st.english_name), '')) as arabic_name,
    nullif(btrim(coalesce(st.english_name, '')), '') as english_name,
    nullif(btrim(coalesce(st.arabic_name, '')), '') as service_type,
    s.buy_price::numeric(12, 2) as buy_price,
    nullif(btrim(coalesce(bc.iso_code, '')), '') as buy_currency,
    s.sell_price::numeric(12, 2) as sell_price,
    nullif(btrim(coalesce(sc.iso_code, '')), '') as sell_currency,
    (
      select pc.country_id
      from legacy_app.cities lc
      join public.cities pc on pg_temp.norm(pc.arabic_name) = pg_temp.norm(lc.arabic_name)
      where lc.country_id = s.country_id
      limit 1
    ) as country_id
  from legacy_app.services s
  left join legacy_app.services_types st on st.id = s.service_type_id
  left join legacy_app.currencies bc on bc.id = s.buy_currency_id
  left join legacy_app.currencies sc on sc.id = s.sell_currency_id
  -- services.status is a smallint here (0/1), not the boolean the other legacy
  -- tables use — comparing it as a boolean aborts the whole transaction.
  where coalesce(s.status, 1) <> 0
    and not exists (
      select 1 from public.legacy_id_map m
      where m.entity = 'service' and m.source = 'app' and m.legacy_id = s.id
    )
),
valid as (
  select * from fresh where arabic_name is not null
),
ins as (
  insert into public.services (
    id, arabic_name, english_name, service_type,
    buy_price, buy_currency, sell_price, sell_currency, country_id
  )
  select
    new_id, arabic_name, english_name, service_type,
    buy_price, buy_currency, sell_price, sell_currency, country_id
  from valid
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'service', 'app', legacy_id, new_id from valid;

commit;
