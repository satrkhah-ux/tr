-- Legacy import, step 5: EMPLOYEES + OFFERS and everything hanging off them.
--
-- ⚠️ THE VERSIONING TRAP: legacy_app.offers holds every EDIT of an offer, not
-- one row per offer. Of its 20,268 rows only 11,449 are the current version
-- (last_edit) and only 5,343 of those are not soft-deleted. Importing the table
-- as-is would create ~4x duplicates mixing deleted and superseded drafts into a
-- live system. Every statement below is therefore scoped to `live_offers`.
--
-- ⚠️ INTERNAL MONEY: buy_price / company_profit are cost-side. They go to
-- public.pricings and to the buy_* columns of offer_pricing_items — both of
-- which the client DTO strips structurally (lib/offer/dto.ts). Nothing here
-- puts a cost figure anywhere a client can reach.
--
-- Status mapping comes from THEIR OWN legacy_app.statuses table, not a guess:
--   group 1 (1-5, "تم إرسال البرنامج" → follow-ups)  -> sent
--   group 2 (6-9, 11: hotels/flights/transport/…)     -> confirmed
--   10 ("إلغاء")                                      -> cancelled
--   anything else / 0                                 -> draft
--
-- Idempotent via public.legacy_id_map.

begin;

create or replace function pg_temp.norm(txt text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(regexp_replace(coalesce(txt, ''), '\s+', ' ', 'g'))), '');
$$;

-- ---------- 1. employees ----------
with fresh as (
  select
    e.id as legacy_id,
    gen_random_uuid() as new_id,
    coalesce(nullif(btrim(e.arabic_name), ''), nullif(btrim(e.english_name), ''), e.email) as arabic_name,
    nullif(btrim(coalesce(e.english_name, '')), '') as english_name,
    nullif(btrim(coalesce(e.email, '')), '') as email,
    -- status is boolean on employees but smallint on services; the legacy
    -- schema is inconsistent, so cast to text before testing.
    case when coalesce(e.status::text, 'true') in ('true', 't', '1') then 'Active' else 'Inactive' end as status
  from legacy_app.employees e
  where not exists (
    select 1 from public.legacy_id_map m
    where m.entity = 'employee' and m.source = 'app' and m.legacy_id = e.id
  )
),
deduped as (
  select f.* from fresh f
  where f.arabic_name is not null
    and not exists (
      select 1 from public.employees pe
      where pg_temp.norm(pe.arabic_name) = pg_temp.norm(f.arabic_name)
         or (pe.email is not null and f.email is not null and lower(pe.email) = lower(f.email))
    )
),
ins as (
  insert into public.employees (id, arabic_name, english_name, email, status)
  select new_id, arabic_name, english_name, email, status from deduped
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'employee', 'app', legacy_id, new_id from deduped;

-- employees that already existed by name/email still need a mapping so offers
-- can point at them.
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'employee', 'app', e.id, pe.id
from legacy_app.employees e
join public.employees pe
  on pg_temp.norm(pe.arabic_name) = pg_temp.norm(e.arabic_name)
  or (pe.email is not null and nullif(btrim(e.email), '') is not null and lower(pe.email) = lower(btrim(e.email)))
where not exists (
  select 1 from public.legacy_id_map m
  where m.entity = 'employee' and m.source = 'app' and m.legacy_id = e.id
)
on conflict do nothing;

-- ---------- 2. offers (current, non-deleted versions only) ----------
create temp table live_offers on commit drop as
select o.*
from legacy_app.offers o
where o.last_edit
  and not o.soft_delete
  and not exists (
    select 1 from public.legacy_id_map m
    where m.entity = 'offer' and m.source = 'app' and m.legacy_id = o.id
  );

create index on live_offers (id);

with fresh as (
  select
    o.id as legacy_id,
    gen_random_uuid() as new_id,
    o.serial::text as serial,
    (select m.new_id from public.legacy_id_map m
      where m.entity = 'customer' and m.source = 'app' and m.legacy_id = o.customer_id) as customer_id,
    (select m.new_id from public.legacy_id_map m
      where m.entity = 'employee' and m.source = 'app' and m.legacy_id = o.employee_id) as employee_id,
    (select nullif(btrim(lc.arabic_name), '') from legacy_app.countries lc where lc.id = o.country_id) as destination,
    o.date as offer_date,
    greatest(coalesce(o.number_of_adults, 0), 0)::int as adults,
    greatest(coalesce(o.number_of_childrens, 0), 0)::int as children,
    greatest(coalesce(o.number_of_infants, 0), 0)::int as infants,
    round(o.sell_price::numeric, 2) as total,
    (select nullif(btrim(cu.iso_code), '') from legacy_app.currencies cu where cu.id = o.currency_id) as currency,
    case
      when o.status = 10 then 'cancelled'
      when o.status between 6 and 11 then 'confirmed'
      when o.status between 1 and 5 then 'sent'
      else 'draft'
    end::public.offer_status as status,
    round(o.buy_price::numeric, 2) as buy_total,
    round(o.company_profit::numeric, 2) as profit
  from live_offers o
),
-- a serial must be unique here; keep the first if the old data ever repeats one
deduped as (
  select distinct on (serial) * from fresh
  where serial is not null
    and not exists (select 1 from public.offers po where po.serial = fresh.serial)
  order by serial, legacy_id
),
ins as (
  insert into public.offers (
    id, serial, customer_id, employee_id, destination, offer_date,
    adults, children, infants, total, currency, status
  )
  select
    new_id, serial, customer_id, employee_id, destination, offer_date,
    adults, children, infants, total, currency, status
  from deduped
),
-- internal money lives here, never on the offer row itself
ins_pricing as (
  insert into public.pricings (offer_id, total, currency, buy_total, sell_total, profit)
  select new_id, total, currency, buy_total, total, profit from deduped
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'offer', 'app', legacy_id, new_id from deduped;

-- ---------- 3. offer cities ----------
insert into public.offer_cities (offer_id, city_name, hotel_name, room_type, nights, meals, stars, sort)
select
  m.new_id,
  coalesce(nullif(btrim(lc.arabic_name), ''), '—'),
  nullif(btrim(lh.arabic_name), ''),
  nullif(btrim(lrt.arabic_name), ''),
  greatest(coalesce(oc.number_of_nights, 0), 0)::int,
  nullif(concat_ws(' + ',
    case when oc.breakfast then 'إفطار' end,
    case when oc.lunch then 'غداء' end,
    case when oc.dinner then 'عشاء' end
  ), ''),
  lh.number_of_stars,
  row_number() over (partition by oc.offer_id order by oc.id)
from legacy_app.offer_cities oc
join public.legacy_id_map m
  on m.entity = 'offer' and m.source = 'app' and m.legacy_id = oc.offer_id
left join legacy_app.cities lc on lc.id = oc.city_id
left join legacy_app.hotels lh on lh.id = oc.hotel_id
left join legacy_app.rooms_types lrt on lrt.id = oc.room_type_id
where not exists (
  select 1 from public.offer_cities poc where poc.offer_id = m.new_id
);

-- ---------- 4. included / excluded services ----------
insert into public.offer_services (offer_id, label, kind, sort)
select m.new_id, btrim(x.arabic_text), x.kind, x.sort
from (
  select offer_id, arabic_text, 'include'::public.offer_service_kind as kind,
         row_number() over (partition by offer_id order by id) as sort
  from legacy_app.offer_includes
  where coalesce(btrim(arabic_text), '') <> ''
  union all
  select offer_id, arabic_text, 'exclude'::public.offer_service_kind,
         row_number() over (partition by offer_id order by id)
  from legacy_app.offer_not_includes
  where coalesce(btrim(arabic_text), '') <> ''
) x
join public.legacy_id_map m
  on m.entity = 'offer' and m.source = 'app' and m.legacy_id = x.offer_id
where not exists (
  select 1 from public.offer_services pos where pos.offer_id = m.new_id
);

-- ---------- 5. terms ----------
insert into public.offer_terms (offer_id, text, sort)
select m.new_id, btrim(regexp_replace(t.arabic_text, '\s+', ' ', 'g')),
       row_number() over (partition by t.offer_id order by t.id)
from legacy_app.offer_terms_and_conditions t
join public.legacy_id_map m
  on m.entity = 'offer' and m.source = 'app' and m.legacy_id = t.offer_id
where coalesce(btrim(t.arabic_text), '') <> ''
  and not exists (
    select 1 from public.offer_terms pot where pot.offer_id = m.new_id
  );

-- ---------- 6. pricing items ----------
-- offer_items is the parent; which extension table holds the same id decides
-- what the line actually is (their four tables sum exactly to offer_items).
insert into public.offer_pricing_items (
  offer_id, item_type, description, quantity,
  buy_price, sell_price, sort
)
select
  m.new_id,
  case
    when h.id is not null then 'hotel'
    when f.id is not null then 'flight'
    when tr.id is not null then 'transport'
    when sv.id is not null then 'service'
    else 'other'
  end,
  nullif(btrim(coalesce(i.description, '')), ''),
  greatest(coalesce(i.count, 1), 1)::int,
  round(i.buy_price::numeric, 2),
  round(i.sell_price::numeric, 2),
  row_number() over (partition by i.offer_id order by i.id)
from legacy_app.offer_items i
join public.legacy_id_map m
  on m.entity = 'offer' and m.source = 'app' and m.legacy_id = i.offer_id
left join legacy_app.offer_item_hotel h on h.id = i.id
left join legacy_app.offer_item_flight f on f.id = i.id
left join legacy_app.offer_item_transfer tr on tr.id = i.id
left join legacy_app.offer_item_service sv on sv.id = i.id
where not exists (
  select 1 from public.offer_pricing_items p where p.offer_id = m.new_id
);

commit;
