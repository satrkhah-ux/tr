-- Data section orders 3 and 11: the data-quality board, and «الفندق المعتمد».
--
-- Additive and idempotent. Nothing here changes a row.
--
-- 1. hotels.verified / verified_by / verified_at — a hotel someone reviewed
--    (name, city, stars, address, phone). Set from the hotel's details screen;
--    the generator's internal hotel search lists verified hotels first.
-- 2. offer_hotels (hotel_id) index — «how many offers use this hotel» is asked
--    for every hotel on the board; without it each ask is a full scan.
-- 3. data_quality_<table>(p_issue) — the rows behind one board card, as the
--    table's own row type, so the generic data screen lists them through
--    PostgREST exactly like the table (filters, search, paging, count) and the
--    card's number IS the filtered table's row count. Hotels come most-used
--    first: offer_hotels + operation_bookings (kind 'hotel', title = arabic_name).
-- 4. data_quality_counts() — every card's number in one call (the board and the
--    weekly Telegram summary). `used` = how many of those hotels an offer or a
--    booking already uses.
--
-- Staff only: each function is SECURITY INVOKER (RLS still applies) and returns
-- nothing unless the caller is an active employee or the service role (the
-- morning cron). Issue keys are mirrored in src/lib/data/quality.ts
-- (quality.test.ts holds the two together).

-- ---------- 1. «الفندق المعتمد» ----------
alter table public.hotels add column if not exists verified boolean not null default false;
alter table public.hotels add column if not exists verified_by uuid references public.employees (id) on delete set null;
alter table public.hotels add column if not exists verified_at timestamptz;

-- ---------- 2. use counts ----------
create index if not exists offer_hotels_hotel_id_idx on public.offer_hotels (hotel_id);

-- The cron reads the counts as the service role; is_staff() is part of every
-- function's gate, and 0034 granted it to authenticated/anon only.
grant execute on function public.is_staff() to service_role;

-- ---------- 3. the rows behind each card ----------
create or replace function public.data_quality_hotel_uses()
returns table (hotel_id uuid, uses int)
language sql
stable
set search_path = public
as $$
  select h.id, (coalesce(o.n, 0) + coalesce(b.n, 0))::int
  from public.hotels h
  left join (
    select oh.hotel_id, count(*) as n
    from public.offer_hotels oh
    where oh.hotel_id is not null
    group by oh.hotel_id
  ) o on o.hotel_id = h.id
  left join (
    select ob.title, count(*) as n
    from public.operation_bookings ob
    where ob.kind = 'hotel'
    group by ob.title
  ) b on b.title = h.arabic_name
  where current_user = 'service_role' or (select public.is_staff());
$$;

create or replace function public.data_quality_hotels(p_issue text)
returns setof public.hotels
language sql
stable
set search_path = public
as $$
  with names as (
    select h.id,
      public.catalog_norm(h.english_name) as en,
      count(*) over (partition by public.catalog_norm(h.english_name)) as en_n,
      public.catalog_norm(h.arabic_name) as ar,
      count(*) over (partition by public.catalog_norm(h.arabic_name)) as ar_n
    from public.hotels h
  ),
  dup as (
    select id from names where (en is not null and en_n > 1) or (ar is not null and ar_n > 1)
  )
  select h.*
  from public.hotels h
  left join public.data_quality_hotel_uses() u on u.hotel_id = h.id
  where (current_user = 'service_role' or (select public.is_staff()))
    and case p_issue
      -- no Arabic LETTER at all: «Hilton», «4*», empty
      when 'hotel_no_arabic' then coalesce(h.arabic_name, '') !~ '[ء-ي]'
      when 'hotel_no_stars' then coalesce(h.stars, 0) < 1
      -- the voucher needs both
      when 'hotel_no_contact' then nullif(btrim(h.address), '') is null or nullif(btrim(h.contact_number), '') is null
      when 'hotel_no_city' then h.city_id is null
      -- same folded English OR Arabic name anywhere — a candidate, never a verdict
      when 'hotel_duplicate' then h.id in (select id from dup)
      when 'hotel_unverified' then not h.verified
      else false
    end
  order by coalesce(u.uses, 0) desc, h.arabic_name, h.id;
$$;

create or replace function public.data_quality_cities(p_issue text)
returns setof public.cities
language sql
stable
set search_path = public
as $$
  select c.*
  from public.cities c
  where (current_user = 'service_role' or (select public.is_staff()))
    and case p_issue
      when 'city_no_default_hotel' then nullif(btrim(c.default_hotel), '') is null
      when 'city_no_coords' then c.lat is null or c.lng is null
      when 'city_no_sort' then c.sort_order is null
      -- Malaysian STATES typed in as cities (the agent means a city inside them)
      when 'city_is_state' then
        lower(btrim(coalesce(c.english_name, ''))) = any (array[
          'selangor', 'kedah', 'johor', 'perak', 'pahang', 'kelantan', 'terengganu',
          'negeri sembilan', 'sabah', 'sarawak', 'perlis'])
        or public.catalog_norm(c.arabic_name) = any (array[
          'سيلانجور', 'سلانجور', 'قدح', 'كيداه', 'كداه', 'جوهر', 'جوهور', 'بيراك', 'باهانج',
          'بهانج', 'كلنتن', 'كلانتان', 'ترنجانو', 'تيرينجانو', 'نجري سمبيلان',
          'نيجيري سيمبيلان', 'صباح', 'ساراواك', 'سراواك', 'برليس'])
      else false
    end
  order by c.arabic_name, c.id;
$$;

create or replace function public.data_quality_room_types(p_issue text)
returns setof public.room_types
language sql
stable
set search_path = public
as $$
  with hotel_names as (
    select public.catalog_norm(arabic_name) as n from public.hotels
    union
    select public.catalog_norm(english_name) from public.hotels where english_name is not null
  )
  select r.*
  from public.room_types r
  where (current_user = 'service_role' or (select public.is_staff()))
    and case p_issue
      -- a hotel's name, a code («A-1 (3 غرف نوم)»), or two rooms in one («غرفة X + غرفة Y»)
      when 'room_not_room' then
        public.catalog_norm(r.arabic_name) in (select n from hotel_names where n is not null)
        or public.catalog_norm(r.english_name) in (select n from hotel_names where n is not null)
        or r.arabic_name ~* '^\s*[a-z]{1,3}\s*-?\s*[0-9]'
        or coalesce(r.english_name, '') ~* '^\s*[a-z]{1,3}\s*-\s*[0-9]'
        or r.arabic_name like '%+%'
        or coalesce(r.english_name, '') like '%+%'
      else false
    end
  order by r.arabic_name, r.id;
$$;

create or replace function public.data_quality_airports(p_issue text)
returns setof public.airports
language sql
stable
set search_path = public
as $$
  select a.*
  from public.airports a
  where (current_user = 'service_role' or (select public.is_staff()))
    and case p_issue
      when 'airport_bad_iata' then coalesce(a.code, '') !~ '^[A-Z]{3}$'
      else false
    end
  order by a.code nulls first, a.id;
$$;

create or replace function public.data_quality_transfers(p_issue text)
returns setof public.transfers
language sql
stable
set search_path = public
as $$
  with airport_keys as (
    select upper(btrim(code)) as k from public.airports where nullif(btrim(code), '') is not null
    union
    select public.catalog_norm(arabic_name) from public.airports
    union
    select public.catalog_norm(english_name) from public.airports where english_name is not null
  )
  select t.*
  from public.transfers t
  where (current_user = 'service_role' or (select public.is_staff()))
    and case p_issue
      -- a transfer price starts at an airport: its name, its code, or the word
      when 'transfer_not_from_airport' then not (
        coalesce(t.from_city, '') ~* '(مطار|airport)'
        or upper(btrim(coalesce(t.from_city, ''))) in (select k from airport_keys where k is not null)
        or coalesce(public.catalog_norm(t.from_city), '') in (select k from airport_keys where k is not null)
      )
      else false
    end
  order by t.from_city, t.id;
$$;

create or replace function public.data_quality_tours(p_issue text)
returns setof public.tours
language sql
stable
set search_path = public
as $$
  with named as (
    select t.id,
      count(*) over (partition by t.country_id, public.catalog_norm(t.arabic_name)) as n
    from public.tours t
  )
  select t.*
  from public.tours t
  where (current_user = 'service_role' or (select public.is_staff()))
    and case p_issue
      -- one tour typed once per car type (order 7 makes it one row with prices per car)
      when 'tour_duplicate' then t.id in (select id from named where n > 1)
      else false
    end
  order by t.arabic_name, t.id;
$$;

-- ---------- 4. every card's number ----------
create or replace function public.data_quality_counts()
returns table (issue text, total int, used int)
language sql
stable
set search_path = public
as $$
  with uses as (select hotel_id, uses from public.data_quality_hotel_uses())
  select k, count(h.id)::int, count(h.id) filter (where u.uses > 0)::int
  from unnest(array['hotel_no_arabic', 'hotel_no_stars', 'hotel_no_contact', 'hotel_no_city',
                    'hotel_duplicate', 'hotel_unverified']) as k
  left join lateral public.data_quality_hotels(k) h on true
  left join uses u on u.hotel_id = h.id
  group by k
  union all
  select k, count(c.id)::int, null::int
  from unnest(array['city_no_default_hotel', 'city_no_coords', 'city_no_sort', 'city_is_state']) as k
  left join lateral public.data_quality_cities(k) c on true
  group by k
  union all
  select 'room_not_room', (select count(*)::int from public.data_quality_room_types('room_not_room')), null::int
  union all
  select 'airport_bad_iata', (select count(*)::int from public.data_quality_airports('airport_bad_iata')), null::int
  union all
  select 'transfer_not_from_airport', (select count(*)::int from public.data_quality_transfers('transfer_not_from_airport')), null::int
  union all
  select 'tour_duplicate', (select count(*)::int from public.data_quality_tours('tour_duplicate')), null::int;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.data_quality_hotel_uses()',
    'public.data_quality_hotels(text)',
    'public.data_quality_cities(text)',
    'public.data_quality_room_types(text)',
    'public.data_quality_airports(text)',
    'public.data_quality_transfers(text)',
    'public.data_quality_tours(text)',
    'public.data_quality_counts()'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
