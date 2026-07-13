-- App Travluin — package-generator data layer.
-- Adds: dual-priced hotel lines (offer_hotels), richer flight legs, a per-item
-- pricing rollup (offer_pricing_items), immutable render snapshots (offer_renders),
-- and manual monthly city climate notes (city_climate_notes).
-- Idempotent; safe to re-run. Extends the existing schema (0001..0007).
--
-- SECURITY MODEL (unchanged principle): buy_price / profit must NEVER be readable
-- by anon (public /client-offer links use the anon key). Therefore:
--   * offer_hotels, offer_pricing_items, offer_renders  -> authenticated only.
--   * offer_flights STAYS anon-readable, so it carries NO buy pricing — flight
--     buy/sell live in offer_pricing_items (item_type='flight') instead.
--   * city_climate_notes carries no pricing and is shown to clients -> anon read.

-- ---------- room_types: hotel scope + capacity + default board ----------
alter table public.room_types add column if not exists hotel_id uuid references public.hotels (id) on delete cascade;
alter table public.room_types add column if not exists capacity int;
alter table public.room_types add column if not exists default_board text;
create index if not exists room_types_hotel_id_idx on public.room_types (hotel_id);

-- ---------- offer_cities: trip-planning columns ----------
-- Already present as check_in / check_out / nights / sort (0001_init.sql), which
-- cover the requested check_in_date / check_out_date / nights_count / sort_order.
-- No change needed.

-- ---------- offer_hotels (NEW): normalized hotel lines with dual pricing ----------
create table if not exists public.offer_hotels (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  offer_city_id uuid references public.offer_cities (id) on delete cascade,
  hotel_id uuid references public.hotels (id) on delete set null,
  hotel_name text,
  room_type_id uuid references public.room_types (id) on delete set null,
  rooms_count int not null default 1,
  board_type text check (board_type in ('RO', 'BB', 'HB', 'FB', 'AI')),
  check_in date,
  check_out date,
  nights int,
  buy_price numeric(12, 2),
  buy_currency text,
  sell_price numeric(12, 2),
  sell_currency text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists offer_hotels_offer_id_idx on public.offer_hotels (offer_id);
create index if not exists offer_hotels_offer_city_id_idx on public.offer_hotels (offer_city_id);

-- ---------- offer_flights: richer leg + schedule fields (client-safe; NO buy pricing) ----------
alter table public.offer_flights add column if not exists airline text;        -- alias display; carrier stays the canonical column
alter table public.offer_flights add column if not exists flight_no text;
alter table public.offer_flights add column if not exists departure_at timestamptz;
alter table public.offer_flights add column if not exists arrival_at timestamptz;
alter table public.offer_flights add column if not exists cabin_class text;      -- alias of cabin
alter table public.offer_flights add column if not exists baggage_allowance text; -- alias of baggage
alter table public.offer_flights add column if not exists leg_order text;
do $$ begin
  alter table public.offer_flights
    add constraint offer_flights_leg_order_chk check (leg_order in ('outbound', 'inbound', 'internal'));
exception when duplicate_object then null; end $$;

-- ---------- offer_pricing_items (NEW): unified per-item buy/sell rollup (server-only) ----------
create table if not exists public.offer_pricing_items (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  item_type text not null check (item_type in ('hotel', 'flight', 'visa', 'service', 'transport', 'other')),
  item_id uuid,
  description text,
  quantity numeric(12, 2) not null default 1,
  buy_price numeric(12, 2),
  buy_currency text,
  sell_price numeric(12, 2),
  sell_currency text,
  total_buy numeric(12, 2),
  total_sell numeric(12, 2),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists offer_pricing_items_offer_id_idx on public.offer_pricing_items (offer_id);

-- ---------- offer_renders (NEW): immutable snapshot of what was actually sent ----------
create table if not exists public.offer_renders (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  version int not null default 1,
  variant text not null check (variant in ('client', 'internal')),
  snapshot_json jsonb not null default '{}'::jsonb,
  file_path text,
  rendered_by uuid references public.employees (id) on delete set null,
  rendered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists offer_renders_offer_id_idx on public.offer_renders (offer_id);

-- ---------- city_climate_notes (NEW): manual monthly climate advice ----------
-- NOT a weather API — forecasts can't cover trips months out, so these are
-- editorially maintained per city + month.
create table if not exists public.city_climate_notes (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities (id) on delete cascade,
  month int not null check (month between 1 and 12),
  avg_high_c numeric(4, 1),
  avg_low_c numeric(4, 1),
  rain_level text check (rain_level in ('low', 'medium', 'high')),
  humidity_level text check (humidity_level in ('low', 'medium', 'high')),
  advice_ar text,
  advice_en text,
  updated_by uuid references public.employees (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (city_id, month)
);
create index if not exists city_climate_notes_city_id_idx on public.city_climate_notes (city_id);

-- ---------- indexes for pricing item soft-refs ----------
create index if not exists offer_pricing_items_item_idx on public.offer_pricing_items (item_type, item_id);

-- ---------- row-level security ----------
do $$
declare
  t text;
  authed_tables text[] := array[
    'offer_hotels', 'offer_pricing_items', 'offer_renders', 'city_climate_notes'
  ];
begin
  foreach t in array authed_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists authenticated_all on public.%I;', t);
    execute format(
      'create policy authenticated_all on public.%I for all to authenticated using (true) with check (true);', t);
  end loop;

  -- Climate advice is client-facing (shown in the offer preview/PDF) and carries
  -- no pricing, so anon may READ it. The pricing/hotel/render tables get NO anon
  -- policy on purpose — they hold buy_price / profit.
  drop policy if exists public_read on public.city_climate_notes;
  create policy public_read on public.city_climate_notes for select to anon using (true);
end $$;
