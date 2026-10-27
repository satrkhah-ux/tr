-- Checks describe the current catalogue model: city-to-city transfers and
-- stations are valid; similarly named tours in different cities are distinct.
create or replace function public.data_quality_airports(p_issue text)
returns setof public.airports language sql stable security invoker set search_path = public as $$
  select a.* from public.airports a
  where (current_user = 'service_role' or (select public.is_staff()))
    and p_issue = 'airport_bad_iata'
    and a.kind = 'airport' and coalesce(a.status, 'Active') not in ('Disabled', 'Inactive')
    and coalesce(a.code, '') !~ '^[A-Z]{3}$'
  order by a.code nulls first, a.id;
$$;

create or replace function public.data_quality_transfers(p_issue text)
returns setof public.transfers language sql stable security invoker set search_path = public as $$
  with places as materialized (
    select country_id, public.catalog_norm(arabic_name) as name from public.cities
    union select country_id, public.catalog_norm(english_name) from public.cities
    union select country_id, public.catalog_norm(arabic_name) from public.airports
    union select country_id, public.catalog_norm(english_name) from public.airports
    union select country_id, public.catalog_norm(code) from public.airports
  )
  select t.* from public.transfers t
  where (current_user = 'service_role' or (select public.is_staff()))
    and p_issue = 'transfer_not_from_airport'
    and (
      nullif(btrim(t.from_city), '') is null or nullif(btrim(t.to_city), '') is null
      or not exists (select 1 from places p where p.name = public.catalog_norm(t.from_city) and (t.country_id is null or p.country_id = t.country_id))
      or not exists (select 1 from places p where p.name = public.catalog_norm(t.to_city) and (t.country_id is null or p.country_id = t.country_id))
    )
  order by t.from_city, t.id;
$$;

create or replace function public.data_quality_tours(p_issue text)
returns setof public.tours language sql stable security invoker set search_path = public as $$
  with named as (
    select t.id, count(*) over (partition by t.country_id, t.city_id,
      public.catalog_norm(t.arabic_name), coalesce(public.catalog_norm(p.description_ar), '')) as n
    from public.tours t left join public.tour_programs p on p.id = t.program_id
  )
  select t.* from public.tours t
  where (current_user = 'service_role' or (select public.is_staff()))
    and p_issue = 'tour_duplicate' and t.id in (select id from named where n > 1)
  order by t.arabic_name, t.id;
$$;

-- The automatic order is alphabetical only for legacy rows without a chosen
-- order; future additions go after the existing order within their country.
create or replace function public.catalog_city_sort()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.sort_order is null then
    perform pg_advisory_xact_lock(hashtextextended('catalog-city-sort:' || coalesce(new.country_id::text, ''), 0));
    select coalesce(max(c.sort_order), 0) + 1 into new.sort_order
    from public.cities c where c.country_id is not distinct from new.country_id and c.id <> new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists catalog_city_sort on public.cities;
create trigger catalog_city_sort before insert or update of sort_order on public.cities
for each row execute function public.catalog_city_sort();

revoke all on function public.catalog_city_sort() from public, anon;
grant execute on function public.catalog_city_sort() to authenticated, service_role;
revoke all on function public.data_quality_airports(text), public.data_quality_transfers(text), public.data_quality_tours(text) from public, anon;
grant execute on function public.data_quality_airports(text), public.data_quality_transfers(text), public.data_quality_tours(text) to authenticated, service_role;

insert into public.integrations (name, kind, used_by, secret_ref, account, check_key, notes)
values (
  'مراجعة وإصلاح جودة بيانات الكتالوج', 'script',
  '/data-quality; scripts/catalog-quality-enrich.mjs; scripts/catalog-quality-repair.mjs',
  'SUPABASE_DB_URL; SETTINGS_ENCRYPTION_KEY; hotel_suppliers.credentials_encrypted',
  'Traveliun — existing TBO account', 'suppliers',
  'Manual maintenance: public static hotel content only; no rate searches or bookings. Repair defaults to a rollback preview, requires reviewed evidence, rejects concurrent edits, excludes price columns and records every change in audit_logs.'
)
on conflict (name) do update set used_by=excluded.used_by, secret_ref=excluded.secret_ref,
  account=excluded.account, check_key=excluded.check_key, notes=excluded.notes, updated_at=now();
notify pgrst, 'reload schema';
