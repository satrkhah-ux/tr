-- ============================================================================
-- 0079 — «البيانات» for sales: view, add and edit; deleting stays the administration's
--
-- The owner's order of 2026-10-17 reorganised the menus: the sales employee sees
-- «الرئيسية», «النظام بيسك», «العمليات» and «البيانات». So the data section opens
-- to data.write (section-access.ts), and inside it the app keeps deleting,
-- merging and importing for settings.manage (data/actions.ts deleteRow /
-- importRows, data/hotel-tools.ts mergeHotels; the table hides the controls).
--
-- The database said less: these tables are `FOR ALL … using (is_staff())`, and
-- signed-in users hold DELETE on them, so any employee could delete a hotel or a
-- city by calling PostgREST with their own token. This splits each policy the
-- way 0073 did for the money tables:
--
--  · SELECT / INSERT / UPDATE: is_staff(), exactly as before — nobody loses a
--    read or a write they have today (the partner read policies are untouched).
--  · DELETE: staff_can('settings.manage').
--  · transfers: DELETE on staff_can('data.write') instead — the price grid
--    (data/price-grid.ts, data.write) clears a cell by deleting its row; the
--    generic «حذف» on /cars/transfers is still settings.manage in the app.
--  · merge_hotels (0070) deletes the merged hotels as SECURITY DEFINER, past RLS:
--    its check moves from is_staff() to staff_can('settings.manage'). The body is
--    0070's — verified identical to the live definition on 2026-10-17 — with that
--    one line changed.
--
-- NOT touched: offer_cities / offer_flights / offer_services / offer_terms and
-- offers — re-issuing a file (data/offer-insert.ts replaceOffer) deletes the old
-- child rows through the agent's own session. tour_prices (the grid's tours)
-- keeps its is_staff() policy from 0072.
--
-- Deploy order: the app code (settings.manage on deleteRow / importRows /
-- mergeHotels) ships FIRST; then this migration. Idempotent.
-- ============================================================================

do $$
declare
  t record;
begin
  for t in
    select * from (values
      -- «البيانات»
      ('countries',            'authenticated_all',           'settings.manage'),
      ('cities',               'authenticated_all',           'settings.manage'),
      ('hotels',               'authenticated_all',           'settings.manage'),
      ('room_types',           'authenticated_all',           'settings.manage'),
      ('airlines',             'airlines_authenticated_all',  'settings.manage'),
      ('airports',             'authenticated_all',           'settings.manage'),
      ('ports',                'authenticated_all',           'settings.manage'),
      ('transportation_types', 'authenticated_all',           'settings.manage'),
      ('drivers',              'authenticated_all',           'settings.manage'),
      ('services',             'authenticated_all',           'settings.manage'),
      ('service_types',        'service_types_staff_all',     'settings.manage'),
      ('tours',                'authenticated_all',           'settings.manage'),
      ('tour_programs',        'tour_programs_staff_all',     'settings.manage'),
      ('company_suppliers',    'company_suppliers_staff_all', 'settings.manage'),
      ('visas',                'visas_staff_all',             'settings.manage'),
      ('terms',                'authenticated_all',           'settings.manage'),
      ('transfers',            'authenticated_all',           'data.write'),
      -- «قسم الإدارة» and the settings: the same generic engine deletes there
      ('customers',            'authenticated_all',           'settings.manage'),
      ('statuses',             'authenticated_all',           'settings.manage'),
      ('supervisors',          'authenticated_all',           'settings.manage'),
      ('guide_informations',   'authenticated_all',           'settings.manage'),
      ('care_tickets',         'authenticated_all',           'settings.manage'),
      ('city_climate_notes',   'authenticated_all',           'settings.manage')
    ) as v(tbl, old_policy, delete_permission)
  loop
    execute format('drop policy if exists %I on public.%I', t.old_policy, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.tbl || '_staff_read', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.tbl || '_staff_insert', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.tbl || '_staff_update', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.tbl || '_manage_delete', t.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())',
                   t.tbl || '_staff_read', t.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_staff())',
                   t.tbl || '_staff_insert', t.tbl);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())',
                   t.tbl || '_staff_update', t.tbl);
    execute format('create policy %I on public.%I for delete to authenticated using (public.staff_can(%L))',
                   t.tbl || '_manage_delete', t.tbl, t.delete_permission);
  end loop;
end $$;

-- ---------- merge_hotels: 0070's body, settings.manage instead of is_staff() ----------
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
  if not public.staff_can('settings.manage') then
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
  'The «دمج» tool in /hotels: moves offer_hotels, hotel_content_cache, legacy_id_map, hotel_rate_memory, room types and draft references from p_drop to p_keep, deletes p_drop, audits. settings.manage only (0079).';
revoke all on function public.merge_hotels(uuid, uuid[]) from public, anon;
grant execute on function public.merge_hotels(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (manual — run as one script; restores the pre-0079 posture, where
-- any active employee may delete these rows):
--
-- do $$
-- declare t record;
-- begin
--   for t in select * from (values
--       ('countries','authenticated_all'), ('cities','authenticated_all'), ('hotels','authenticated_all'),
--       ('room_types','authenticated_all'), ('airlines','airlines_authenticated_all'), ('airports','authenticated_all'),
--       ('ports','authenticated_all'), ('transportation_types','authenticated_all'), ('drivers','authenticated_all'),
--       ('services','authenticated_all'), ('service_types','service_types_staff_all'), ('tours','authenticated_all'),
--       ('tour_programs','tour_programs_staff_all'), ('company_suppliers','company_suppliers_staff_all'),
--       ('visas','visas_staff_all'), ('terms','authenticated_all'), ('transfers','authenticated_all'),
--       ('customers','authenticated_all'), ('statuses','authenticated_all'), ('supervisors','authenticated_all'),
--       ('guide_informations','authenticated_all'), ('care_tickets','authenticated_all'),
--       ('city_climate_notes','authenticated_all')) as v(tbl, old_policy)
--   loop
--     execute format('drop policy if exists %I on public.%I', t.tbl || '_staff_read', t.tbl);
--     execute format('drop policy if exists %I on public.%I', t.tbl || '_staff_insert', t.tbl);
--     execute format('drop policy if exists %I on public.%I', t.tbl || '_staff_update', t.tbl);
--     execute format('drop policy if exists %I on public.%I', t.tbl || '_manage_delete', t.tbl);
--     execute format('create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t.old_policy, t.tbl);
--   end loop;
-- end $$;
-- -- merge_hotels: re-run its definition from 0070_data_tools.sql (is_staff()).
-- notify pgrst, 'reload schema';
-- ============================================================================
