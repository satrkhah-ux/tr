-- Count the hotel checks from one visible catalogue snapshot. The old summary
-- called the sorted hotel-list RPC six times, repeating catalogue normalization,
-- booking-use joins and RLS checks. Keep the same predicates and caller's RLS.
create or replace function public.data_quality_counts()
returns table (issue text, total int, used int)
language sql
stable
security invoker
set search_path = public
as $$
  with hotels as materialized (
    select h.id, h.arabic_name, h.stars, h.address, h.contact_number, h.city_id, h.verified,
      public.catalog_norm(h.english_name) as en,
      public.catalog_norm(h.arabic_name) as ar
    from public.hotels h
    where current_user = 'service_role' or (select public.is_staff())
  ),
  names as materialized (
    select h.*, count(*) over (partition by en) as en_n, count(*) over (partition by ar) as ar_n
    from hotels h
  ),
  uses as materialized (select hotel_id, uses from public.data_quality_hotel_uses()),
  checks as materialized (
    select h.id, coalesce(u.uses, 0) > 0 as in_use, v.issue, v.matches
    from names h
    left join uses u on u.hotel_id = h.id
    cross join lateral (values
      ('hotel_no_arabic', coalesce(h.arabic_name, '') !~ '[ء-ي]'),
      ('hotel_no_stars', coalesce(h.stars, 0) < 1),
      ('hotel_no_contact', nullif(btrim(h.address), '') is null or nullif(btrim(h.contact_number), '') is null),
      ('hotel_no_city', h.city_id is null),
      ('hotel_duplicate', (h.en is not null and h.en_n > 1) or (h.ar is not null and h.ar_n > 1)),
      ('hotel_unverified', not h.verified)
    ) v(issue, matches)
  )
  select k, count(c.id)::int, count(c.id) filter (where c.in_use)::int
  from unnest(array['hotel_no_arabic', 'hotel_no_stars', 'hotel_no_contact', 'hotel_no_city',
                    'hotel_duplicate', 'hotel_unverified']) as k
  left join checks c on c.issue = k and c.matches
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

revoke all on function public.data_quality_counts() from public, anon;
grant execute on function public.data_quality_counts() to authenticated, service_role;
notify pgrst, 'reload schema';
