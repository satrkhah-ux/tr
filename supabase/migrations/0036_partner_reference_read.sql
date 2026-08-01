-- App Travluin — a partner can read the catalogue, and nothing else.
--
-- 0034 closed every table to non-staff, which is what made partner accounts safe
-- to hand out. It also left a partner looking at a generator whose every
-- dropdown was empty: no countries, no cities, no hotels, no room types. They
-- could sign in and could not build anything.
--
-- These are catalogue tables: names of places, hotels, carriers, room types, and
-- the approved wording for what an offer includes. They carry no money, no
-- client, and nothing about another partner. A reseller building a package needs
-- exactly this list and needs it read-only.
--
-- NOT granted here, and each for a reason:
--   markup_rules      how WE price. A partner reading it learns our margin.
--   pricings, offers  other people's work and our cost basis (0034/0035).
--   customers         our direct clients are not a partner's to see.
--   employees, roles  who works here is not catalogue data.

do $$
declare t text;
begin
  foreach t in array array[
    'countries', 'cities', 'hotels', 'room_types', 'airlines', 'airports',
    'ports', 'transfers', 'tours', 'transportation_types', 'services',
    'statuses', 'terms', 'city_climate_notes', 'hotel_content_cache'
  ]
  loop
    -- Skip a table that does not exist rather than failing the whole migration:
    -- this list spans features added at different times.
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', t || '_partner_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.current_partner_id() is not null)',
      t || '_partner_read', t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
