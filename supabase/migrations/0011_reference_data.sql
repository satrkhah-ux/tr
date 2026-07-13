-- App Travluin — reference data the package generator needs (schema).
-- Extends countries + airports and adds transportation_types. Idempotent.
-- Seeds live in 0012_reference_seed.sql. Naming keeps the existing convention
-- (arabic_name/english_name) and maps the requested fields onto it:
--   name_ar -> arabic_name, name_en -> english_name, default_currency -> default_currency,
--   status -> status. New columns are added for the rest.

-- ---------- countries: iso2 + timezone + visa flag ----------
alter table public.countries add column if not exists iso2 text;
alter table public.countries add column if not exists timezone text;              -- primary IANA tz
alter table public.countries add column if not exists visa_required boolean;       -- general destination flag
-- iso2 is the stable join key for airports; unique but nullable (many NULLs allowed).
create unique index if not exists countries_iso2_uidx on public.countries (iso2) where iso2 is not null;

-- ---------- airports: full flight-engine shape (code = IATA) ----------
alter table public.airports add column if not exists icao text;
alter table public.airports add column if not exists city_id uuid references public.cities (id) on delete set null;
alter table public.airports add column if not exists iana_timezone text;           -- REQUIRED by the flight engine
alter table public.airports add column if not exists lat numeric(9, 6);
alter table public.airports add column if not exists lng numeric(9, 6);
alter table public.airports add column if not exists status text not null default 'Active';
create index if not exists airports_city_id_idx on public.airports (city_id);
create index if not exists airports_code_idx on public.airports (code);

-- ---------- transportation_types (NEW): admin-editable catalog with dual pricing ----------
create table if not exists public.transportation_types (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  category text,                         -- e.g. transfer / disposal / tour / rental / special
  vehicle_class text,                    -- e.g. sedan / suv / van / minibus / bus / limo / boat / train …
  pax_capacity int,
  luggage_capacity int,
  with_driver boolean not null default true,
  duration_unit text check (duration_unit in ('trip', 'hour', 'day')),
  buy_price numeric(12, 2),
  buy_currency text,
  sell_price numeric(12, 2),
  sell_currency text,
  status text not null default 'Active',
  created_at timestamptz not null default now()
);

-- ---------- row-level security (internal — authenticated employees) ----------
do $$ begin
  execute 'alter table public.transportation_types enable row level security';
  execute 'drop policy if exists authenticated_all on public.transportation_types';
  execute 'create policy authenticated_all on public.transportation_types for all to authenticated using (true) with check (true)';
end $$;
