-- The catalogue, cleaned up — part 2 of 2: stop the duplicates coming back.
--
-- Applied AFTER scripts/catalog-dedupe-apply.mjs has merged the existing
-- duplicates; before that these indexes cannot be built.
--
-- Cities and room types are held to one row per folded name by the database.
-- Hotels are NOT: two real hotels in one city can share an Arabic name (and a
-- handful of pairs still await a person who knows them — see
-- docs/research/catalog-duplicates.md), so for hotels the guard is the
-- «هل تقصد …؟» check in createHotelForCity.

create unique index if not exists cities_country_name_uidx
  on public.cities (country_id, public.catalog_norm(arabic_name));

-- room_types are global (hotel_id null) almost everywhere; coalesce so the
-- global rows collide with each other instead of being NULL-distinct.
create unique index if not exists room_types_hotel_name_uidx
  on public.room_types (
    coalesce(hotel_id, '00000000-0000-0000-0000-000000000000'::uuid),
    public.catalog_norm(arabic_name)
  );
