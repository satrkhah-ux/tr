-- Data section tools (orders 1·3, 2 and 10 of docs/DATA-SECTION-PROMPTS-AR.md).
--
-- 1. hotels.status — a hotel still used by an offer is never deleted; it is
--    stopped («إيقاف») instead. 'Active' | 'Inactive'.
-- 2. catalog_skel() — the consonant skeleton of a folded name, so «ملينيوم»
--    finds «ميلينيوم». Mirrors catalogSkel() in src/lib/catalog/norm.ts.
-- 3. search_key(<row>) — a PostgREST computed field on each data-section table:
--    every text column of the row, folded by catalog_norm (ة/ه، ى/ي، أ/إ/آ/ا،
--    diacritics) and by catalog_skel. The engine's search box filters on it
--    (src/lib/data/actions.ts, SEARCH_KEY_TABLES in table-config.ts) and falls
--    back to plain ilike where it is absent.
-- 4. merge_hotels() — the permanent «دمج» tool: the same moves as
--    scripts/catalog-cleanup-2026-10-13.mjs, in one transaction, with an
--    audit_logs row.
--
-- Additive and idempotent; safe to re-run.

-- ---------------------------------------------------------------- 1 ----
alter table public.hotels add column if not exists status text not null default 'Active';

-- ---------------------------------------------------------------- 2 ----
create or replace function public.catalog_skel(txt text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        translate(coalesce(public.catalog_norm(txt), ''), 'اويءئؤaeiouy', ''),
        '[ _.,''"()&/*+:;!?#@،-]', '', 'g'
      ),
      '(.)\1+', '\1', 'g'
    ), '');
$$;

comment on function public.catalog_skel(text) is
  'Consonant skeleton of a catalog_norm-folded name (fuzzy search). Keep in step with catalogSkel in src/lib/catalog/norm.ts.';

-- ---------------------------------------------------------------- 3 ----
-- The row's text values (not ids, not timestamps), one string.
create or replace function public.catalog_row_text(j jsonb)
returns text
language sql
immutable
parallel safe
as $$
  select string_agg(e.value #>> '{}', ' ' order by e.key)
  from jsonb_each(j) e
  where jsonb_typeof(e.value) = 'string'
    and e.key <> 'id'
    and e.key !~ '_(id|at)$';
$$;

create or replace function public.catalog_search_key(txt text)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(public.catalog_norm(txt), '') || ' ~ ' || coalesce(public.catalog_skel(txt), '');
$$;

-- services / transportation_types are left out: their buy price is column-granted
-- (0047) and a whole-row reference needs every column. They keep plain ilike.
do $$
declare t text;
begin
  foreach t in array array[
    'countries', 'cities', 'hotels', 'room_types', 'service_types', 'terms', 'airlines', 'airports',
    'markup_rules', 'ports', 'drivers', 'tour_programs', 'company_suppliers', 'tours', 'transfers'
  ] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format(
        'create or replace function public.search_key(r public.%I) returns text language sql stable parallel safe as %L',
        t,
        'select public.catalog_search_key(public.catalog_row_text(to_jsonb(r)))'
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- 4 ----
-- One draft's `hotels` array with the merged hotel and room-type ids repointed:
-- hotels[].hotel_id, hotels[].room_type_id, hotels[].rooms[].room_type_id —
-- exactly the fields the clean-up script rewrites.
create or replace function public.hotel_merge_remap(p_hotels jsonb, p_keep text, p_drops text[], p_rooms jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(
    case when jsonb_typeof(h) <> 'object' then h else
      h
      || case when h ->> 'hotel_id' = any (p_drops) then jsonb_build_object('hotel_id', p_keep) else '{}'::jsonb end
      || case when p_rooms ? coalesce(h ->> 'room_type_id', '')
              then jsonb_build_object('room_type_id', p_rooms ->> (h ->> 'room_type_id')) else '{}'::jsonb end
      || case when jsonb_typeof(h -> 'rooms') = 'array' then jsonb_build_object('rooms', (
           select coalesce(jsonb_agg(
             case when jsonb_typeof(r) = 'object' and p_rooms ? coalesce(r ->> 'room_type_id', '')
                  then r || jsonb_build_object('room_type_id', p_rooms ->> (r ->> 'room_type_id'))
                  else r end
             order by o), '[]'::jsonb)
           from jsonb_array_elements(h -> 'rooms') with ordinality as x (r, o)))
         else '{}'::jsonb end
    end
    order by i), '[]'::jsonb)
  from jsonb_array_elements(p_hotels) with ordinality as e (h, i);
$$;

-- Merge p_drop into p_keep: every reference moves, then the dropped rows go.
-- Errors (the whole merge rolls back): forbidden, nothing_to_merge, hotel_not_found.
create or replace function public.merge_hotels(p_keep uuid, p_drop uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_drops uuid[];
  d uuid;
  rt record;
  v_twin uuid;
  v_rooms jsonb := '{}'::jsonb;
  v_dropped jsonb;
  v_counts jsonb;
  n integer;
  n_offer_hotels integer := 0;
  n_cache integer := 0;
  n_legacy integer := 0;
  n_rates integer := 0;
  n_rates_dup integer := 0;
  n_rooms_moved integer := 0;
  n_rooms_merged integer := 0;
  n_drafts integer := 0;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_drops
  from unnest(coalesce(p_drop, '{}')) x
  where x is not null and x is distinct from p_keep;
  if p_keep is null or cardinality(v_drops) = 0 then
    raise exception 'nothing_to_merge';
  end if;

  perform 1 from public.hotels where id = p_keep or id = any (v_drops) for update;
  select count(*) into n from public.hotels where id = p_keep or id = any (v_drops);
  if n <> cardinality(v_drops) + 1 then
    raise exception 'hotel_not_found';
  end if;

  select jsonb_agg(jsonb_build_object('id', id, 'arabic_name', arabic_name, 'english_name', english_name, 'city_id', city_id))
    into v_dropped
  from public.hotels where id = any (v_drops);

  foreach d in array v_drops loop
    update public.offer_hotels set hotel_id = p_keep where hotel_id = d;
    get diagnostics n = row_count; n_offer_hotels := n_offer_hotels + n;
    update public.hotel_content_cache set internal_hotel_id = p_keep where internal_hotel_id = d;
    get diagnostics n = row_count; n_cache := n_cache + n;
    update public.legacy_id_map set new_id = p_keep where entity = 'hotel' and new_id = d;
    get diagnostics n = row_count; n_legacy := n_legacy + n;

    -- a remembered price the kept hotel already has for the same room and board wins
    delete from public.hotel_rate_memory r
     where r.hotel_id = d
       and exists (
         select 1 from public.hotel_rate_memory k
          where k.hotel_id = p_keep and k.room_type_name = r.room_type_name
            and coalesce(k.board_type, '') = coalesce(r.board_type, ''));
    get diagnostics n = row_count; n_rates_dup := n_rates_dup + n;
    update public.hotel_rate_memory set hotel_id = p_keep where hotel_id = d;
    get diagnostics n = row_count; n_rates := n_rates + n;

    -- its room types join the kept hotel's — a name it already has becomes that one
    for rt in select id, arabic_name from public.room_types where hotel_id = d order by created_at, id loop
      select id into v_twin from public.room_types
       where hotel_id = p_keep and public.catalog_norm(arabic_name) = public.catalog_norm(rt.arabic_name)
       limit 1;
      if v_twin is not null then
        v_rooms := v_rooms || jsonb_build_object(rt.id::text, v_twin::text);
        update public.offer_hotels set room_type_id = v_twin where room_type_id = rt.id;
        update public.legacy_id_map set new_id = v_twin where entity = 'room_type' and new_id = rt.id;
        delete from public.room_types where id = rt.id;
        n_rooms_merged := n_rooms_merged + 1;
      else
        update public.room_types set hotel_id = p_keep where id = rt.id;
        n_rooms_moved := n_rooms_moved + 1;
      end if;
    end loop;
  end loop;

  -- drafts: a hotel or a room type that went points at the one kept
  update public.offer_drafts dr
     set data = jsonb_set(dr.data, '{hotels}',
       public.hotel_merge_remap(dr.data -> 'hotels', p_keep::text, v_drops::text[], v_rooms))
   where jsonb_typeof(dr.data -> 'hotels') = 'array'
     and public.hotel_merge_remap(dr.data -> 'hotels', p_keep::text, v_drops::text[], v_rooms)
         is distinct from dr.data -> 'hotels';
  get diagnostics n_drafts = row_count;

  delete from public.hotels where id = any (v_drops);

  v_counts := jsonb_build_object(
    'offer_hotels', n_offer_hotels, 'drafts', n_drafts, 'rates', n_rates, 'rates_duplicate', n_rates_dup,
    'rooms_moved', n_rooms_moved, 'rooms_merged', n_rooms_merged, 'content_cache', n_cache,
    'legacy_ids', n_legacy, 'hotels_removed', cardinality(v_drops));

  insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, meta)
  values (
    (select e.id from public.employees e where e.auth_user_id = auth.uid() limit 1),
    auth.jwt() ->> 'email',
    'hotel.merged', 'hotels', p_keep::text,
    jsonb_build_object('dropped', v_dropped, 'counts', v_counts));

  return v_counts;
end;
$$;

comment on function public.merge_hotels(uuid, uuid[]) is
  'The «دمج» tool in /hotels: moves offer_hotels, hotel_content_cache, legacy_id_map, hotel_rate_memory, room types and draft references from p_drop to p_keep, deletes p_drop, audits. Staff only.';

-- It writes the cost tables and the drafts no session may touch (0047): only a
-- signed-in member of staff, through the server action behind data.write.
revoke all on function public.merge_hotels(uuid, uuid[]) from public, anon;
grant execute on function public.merge_hotels(uuid, uuid[]) to authenticated;

-- The usage counts and the merge read these by hotel / room type.
create index if not exists offer_hotels_hotel_id_idx on public.offer_hotels (hotel_id);
create index if not exists offer_hotels_room_type_id_idx on public.offer_hotels (room_type_id);
create index if not exists hotel_content_cache_internal_hotel_idx on public.hotel_content_cache (internal_hotel_id);

notify pgrst, 'reload schema';
