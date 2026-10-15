-- The reference data's model — data section orders 4 to 9 (docs/DATA-SECTION-PROMPTS-AR.md).
--
-- ADDITIVE ONLY: new columns are nullable or defaulted, new tables are
-- staff-only, and no existing row is changed here. Every change to existing
-- DATA (room types re-attached to their hotels, old transfer rows classified,
-- tours grouped, names fixed, …) is a reviewed proposal applied by its own
-- script — scripts/data-<topic>-proposal.mjs then scripts/data-<topic>-apply.mjs.
--
-- Safe for the code already running: nothing it reads or writes is renamed or
-- removed. The one rule that bites an existing row is the IATA check, added NOT
-- VALID — see 5.
--
-- Idempotent: every statement can run twice.

-- ---------- 4. room types: one category ----------
-- single … villa, the list in src/lib/catalog/model.ts ROOM_CATEGORIES; filled
-- by data-rooms (classifyRoom) and reviewed on /rooms-types. Null = not yet decided.
alter table public.room_types add column if not exists category text;
do $$ begin
  alter table public.room_types add constraint room_types_category_check check (
    category is null or category in (
      'single', 'double', 'twin', 'triple', 'quad', 'family', 'connecting', 'standard', 'superior',
      'deluxe', 'executive', 'suite', 'studio', 'apartment', 'villa', 'chalet', 'bungalow'
    )
  );
exception when duplicate_object then null; end $$;

-- ---------- 5. airports: an airport, a station or a port ----------
-- Every row is an airport until data-places says otherwise; the generator offers
-- only kind = 'airport' where a flight needs one.
alter table public.airports add column if not exists kind text not null default 'airport';
do $$ begin
  alter table public.airports add constraint airports_kind_check
    check (kind in ('airport', 'train_station', 'bus_station', 'port'));
exception when duplicate_object then null; end $$;

-- An IATA code is three capital letters, and only an airport has one. NOT VALID:
-- the rows already wrong («12go», «AA», «AB») are not checked now, but any edit
-- of such a row must fix its code in the same save. data-places-apply fixes them
-- and then VALIDATEs the constraint.
do $$ begin
  alter table public.airports add constraint airports_iata_check
    check (code is null or (kind = 'airport' and code ~ '^[A-Z]{3}$')) not valid;
exception when duplicate_object then null; end $$;

-- ---------- 6. transfers: from a point to an area ----------
-- «مطار كوالالمبور ← كوالالمبور» as ids, not words: from an airport / station /
-- port (a row of /airports, its kind saying which) or a city, to a city. The
-- text columns from_city / to_city stay and are still written, so everything
-- that reads them keeps working. No FK: the id points at airports or cities by kind.
alter table public.transfers add column if not exists from_kind text;
alter table public.transfers add column if not exists from_id uuid;
alter table public.transfers add column if not exists to_kind text;
alter table public.transfers add column if not exists to_id uuid;
do $$ begin
  alter table public.transfers add constraint transfers_point_check check (
    (from_kind is null or from_kind in ('airport', 'station', 'port', 'city'))
    and (to_kind is null or to_kind in ('airport', 'station', 'port', 'city'))
    and ((from_kind is null) = (from_id is null))
    and ((to_kind is null) = (to_id is null))
  );
exception when duplicate_object then null; end $$;
-- one price per road and vehicle; the old text rows (kinds null) are not held to it
create unique index if not exists transfers_point_uidx
  on public.transfers (from_kind, from_id, to_kind, to_id, car_type);

-- ---------- 7. tours: one record, a price per vehicle ----------
-- The legacy import made one tours row per (tour × vehicle), the vehicle in the
-- name. A tour is now one row (its city, its ready programme, its length) and its
-- prices are rows of tour_prices; data-tours groups the old rows.
alter table public.tours add column if not exists city_id uuid references public.cities (id) on delete set null;
alter table public.tours add column if not exists program_id uuid references public.tour_programs (id) on delete set null;
alter table public.tours add column if not exists duration_hours numeric(4, 1);

create table if not exists public.tour_prices (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours (id) on delete cascade,
  -- the vehicle as the fleet names it (transportation_types.arabic_name), like transfers.car_type
  car_type text not null,
  price numeric(12, 2) not null,
  currency text not null default 'SAR',
  created_at timestamptz not null default now(),
  unique (tour_id, car_type)
);

alter table public.tour_prices enable row level security;
revoke all on public.tour_prices from anon;
-- what we PAY for a tour: staff only, like tours.price since 0056
drop policy if exists tour_prices_staff_all on public.tour_prices;
create policy tour_prices_staff_all on public.tour_prices
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------- 8. drivers: where they work, and for whom ----------
alter table public.drivers add column if not exists city_id uuid references public.cities (id) on delete set null;
alter table public.drivers add column if not exists supplier_id uuid references public.company_suppliers (id) on delete set null;
alter table public.drivers add column if not exists status text not null default 'Active';

-- ---------- 9. visas: a country of /countries ----------
-- /visas was a static page scraped from the old system. Its rows move here
-- (data-texts); `country` keeps the old free text for now, `country_id` is the
-- country itself.
create table if not exists public.visas (
  id uuid primary key default gen_random_uuid(),
  country text,
  country_id uuid references public.countries (id) on delete set null,
  visa_type text,
  buy_price numeric(12, 2),
  buy_currency text,
  sell_price numeric(12, 2),
  sell_currency text,
  arabic_requirements text,
  english_requirements text,
  status text not null default 'Active',
  created_at timestamptz not null default now()
);
create index if not exists visas_country_id_idx on public.visas (country_id);

alter table public.visas enable row level security;
revoke all on public.visas from anon;
drop policy if exists visas_staff_all on public.visas;
create policy visas_staff_all on public.visas
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- the buy side neither read nor written without pricing.internal, as services in 0047.
-- Mirrored in src/lib/data/table-config.ts GRANTED_COLUMNS (a test holds them together).
revoke select, insert, update on public.visas from authenticated;
grant select (id, country, country_id, visa_type, sell_price, sell_currency, arabic_requirements, english_requirements, status, created_at),
      insert (id, country, country_id, visa_type, sell_price, sell_currency, arabic_requirements, english_requirements, status, created_at),
      update (id, country, country_id, visa_type, sell_price, sell_currency, arabic_requirements, english_requirements, status, created_at)
  on public.visas to authenticated;

notify pgrst, 'reload schema';
