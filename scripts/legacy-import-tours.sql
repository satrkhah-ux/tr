-- Legacy import, step 4: TOURS.
--
-- In the old system tours were stored inside the `transfers` table as type = 4:
-- a starting point, a description of what the tour covers, and NO destination —
-- because a tour does not have one. Their prices live in transfer_cars_prices
-- exactly like a transfer's.
--
-- Importing them as transfers would have produced 1,214 nonsense rows with an
-- empty "to" city. They belong in public.tours instead, which is shaped for
-- them (name + price + currency + country).
--
-- Idempotent via public.legacy_id_map ('tour' entity, so it cannot collide with
-- the 'transfer' rows already imported from the same source table).

begin;

create or replace function pg_temp.norm(txt text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(regexp_replace(coalesce(txt, ''), '\s+', ' ', 'g'))), '');
$$;

with priced as (
  select
    p.id as legacy_id,
    gen_random_uuid() as new_id,
    -- The description is what actually identifies the tour ("رحلة لشمال بالي");
    -- point_1_arabic_name is just "الجولة الأولى" for nearly all of them, so it
    -- is only a fallback when there is no description at all.
    coalesce(
      nullif(btrim(regexp_replace(coalesce(t.arabic_description, ''), '\s+', ' ', 'g')), ''),
      nullif(btrim(regexp_replace(coalesce(t.english_description, ''), '\s+', ' ', 'g')), ''),
      nullif(btrim(t.point_1_arabic_name), '')
    ) as arabic_name,
    nullif(btrim(regexp_replace(coalesce(t.english_description, ''), '\s+', ' ', 'g')), '') as english_name,
    p.price::numeric(12, 2) as price,
    nullif(btrim(coalesce(cu.iso_code, '')), '') as currency,
    (
      select pc.country_id
      from legacy_app.cities lc
      join public.cities pc on pg_temp.norm(pc.arabic_name) = pg_temp.norm(lc.arabic_name)
      where lc.id = t.point_1_city
      limit 1
    ) as country_id,
    coalesce(nullif(btrim(ct.arabic_name), ''), nullif(btrim(ct.english_name), '')) as car_type
  from legacy_app.transfer_cars_prices p
  join legacy_app.transfers t on t.id = p.transfer_id
  left join legacy_app.cars_types ct on ct.id = p.car_type_id
  left join legacy_app.currencies cu on cu.id = p.currency_id
  where t.type = 4
    and coalesce(p.status, true)
    and not exists (
      select 1 from public.legacy_id_map m
      where m.entity = 'tour' and m.source = 'app' and m.legacy_id = p.id
    )
),
fresh as (
  -- the same tour is priced per car type; keep the car type in the name so the
  -- agent can tell "… (باص كبير)" from "… (سيارة متوسطة)" when picking one.
  select
    legacy_id,
    new_id,
    case
      when car_type is null then arabic_name
      else arabic_name || ' (' || car_type || ')'
    end as arabic_name,
    english_name,
    price,
    currency,
    country_id
  from priced
  where arabic_name is not null and price is not null
),
ins as (
  insert into public.tours (id, arabic_name, english_name, price, currency, country_id)
  select new_id, arabic_name, english_name, price, currency, country_id from fresh
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'tour', 'app', legacy_id, new_id from fresh;

commit;
