-- App Travluin — data foundation schema
-- Mirrors src/lib/types.ts. Run before seed.sql.
--
-- Entities: Country, City, Hotel, RoomType, Service, Term, Flight, Customer,
-- Employee, Role, Offer, OfferCity, OfferFlight, OfferService, OfferTerm,
-- Pricing, OfferRevision.

create extension if not exists pgcrypto;

-- ---------- enums ----------
do $$ begin
  create type public.term_kind as enum ('include', 'exclude', 'term');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.offer_service_kind as enum ('include', 'exclude');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.offer_status as enum ('draft', 'sent', 'confirmed', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------- reference tables ----------
create table if not exists public.countries (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  code text,
  default_currency text,
  weekend text,
  status text not null default 'Active',
  created_at timestamptz not null default now()
);

create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  country_id uuid references public.countries (id) on delete set null,
  arabic_name text not null,
  english_name text,
  default_hotel text,
  created_at timestamptz not null default now()
);

create table if not exists public.hotels (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references public.cities (id) on delete set null,
  country_id uuid references public.countries (id) on delete set null,
  arabic_name text not null,
  english_name text,
  stars int,
  address text,
  google_maps text,
  contact_number text,
  website text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.room_types (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  country_id uuid references public.countries (id) on delete set null,
  arabic_name text,
  english_name text,
  service_type text,
  buy_price numeric(12, 2),
  buy_currency text,
  sell_price numeric(12, 2),
  sell_currency text,
  created_at timestamptz not null default now()
);

create table if not exists public.terms (
  id uuid primary key default gen_random_uuid(),
  kind public.term_kind not null,
  arabic_text text not null,
  english_text text,
  checked boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.flights (
  id uuid primary key default gen_random_uuid(),
  carrier text,
  from_airport text,
  to_airport text,
  flight_date date,
  passengers int,
  baggage text,
  cabin text,
  type text,
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company text,
  arabic_name text not null,
  english_name text,
  mobile text,
  email text,
  second_mobile text,
  birth_date date,
  passport_first_name text,
  passport_last_name text,
  passport_number text,
  passport_issue_date date,
  passport_expiry_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  email text,
  mobile text,
  role_id uuid references public.roles (id) on delete set null,
  type text,
  status text not null default 'Active',
  auth_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- offers ----------
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  serial text not null unique,
  customer_id uuid references public.customers (id) on delete set null,
  employee_id uuid references public.employees (id) on delete set null,
  destination text,
  duration text,
  offer_date date,
  adults int not null default 0,
  children int not null default 0,
  infants int not null default 0,
  total numeric(12, 2),
  currency text,
  status public.offer_status not null default 'draft',
  pdf_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.offer_cities (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  city_name text not null,
  hotel_name text,
  room_type text,
  check_in date,
  check_out date,
  nights int,
  meals text,
  stars int,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.offer_flights (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  flight_date date,
  passengers int,
  carrier text,
  from_airport text,
  to_airport text,
  baggage text,
  cabin text,
  type text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.offer_services (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  label text not null,
  kind public.offer_service_kind not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.offer_terms (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  text text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.pricings (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references public.offers (id) on delete cascade,
  total numeric(12, 2),
  currency text,
  buy_total numeric(12, 2),
  sell_total numeric(12, 2),
  profit numeric(12, 2),
  created_at timestamptz not null default now()
);

create table if not exists public.offer_revisions (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  revision int not null default 1,
  snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now()
);

-- ---------- indexes ----------
create index if not exists cities_country_id_idx on public.cities (country_id);
create index if not exists hotels_city_id_idx on public.hotels (city_id);
create index if not exists hotels_country_id_idx on public.hotels (country_id);
create index if not exists services_country_id_idx on public.services (country_id);
create index if not exists employees_role_id_idx on public.employees (role_id);
create index if not exists employees_auth_user_id_idx on public.employees (auth_user_id);
create index if not exists offers_customer_id_idx on public.offers (customer_id);
create index if not exists offers_employee_id_idx on public.offers (employee_id);
create index if not exists offer_cities_offer_id_idx on public.offer_cities (offer_id);
create index if not exists offer_flights_offer_id_idx on public.offer_flights (offer_id);
create index if not exists offer_services_offer_id_idx on public.offer_services (offer_id);
create index if not exists offer_terms_offer_id_idx on public.offer_terms (offer_id);
create index if not exists offer_revisions_offer_id_idx on public.offer_revisions (offer_id);

-- ---------- row-level security ----------
-- Internal admin tool: any authenticated employee has full access. Public
-- (anon) may only READ offers and their children so that shareable
-- /client-offer/[serial] links work without a login.

do $$
declare
  t text;
  authed_tables text[] := array[
    'countries','cities','hotels','room_types','services','terms','flights',
    'customers','roles','employees','offers','offer_cities','offer_flights',
    'offer_services','offer_terms','pricings','offer_revisions'
  ];
  public_read_tables text[] := array[
    'offers','offer_cities','offer_flights','offer_services','offer_terms','pricings'
  ];
begin
  foreach t in array authed_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists authenticated_all on public.%I;', t);
    execute format(
      'create policy authenticated_all on public.%I for all to authenticated using (true) with check (true);', t);
  end loop;

  foreach t in array public_read_tables loop
    execute format('drop policy if exists public_read on public.%I;', t);
    execute format('create policy public_read on public.%I for select to anon using (true);', t);
  end loop;
end $$;
