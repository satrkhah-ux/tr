-- App Travluin — lookup tables for the remaining sidebar routes.
-- Mirrors the new interfaces in src/lib/types.ts. Run after 0001/0002.

create table if not exists public.airports (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  code text,
  country_id uuid references public.countries (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ports (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  country_id uuid references public.countries (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  mobile text,
  country_id uuid references public.countries (id) on delete set null,
  car_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.tours (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  country_id uuid references public.countries (id) on delete set null,
  price numeric(12, 2),
  currency text,
  created_at timestamptz not null default now()
);

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  from_city text,
  to_city text,
  car_type text,
  price numeric(12, 2),
  currency text,
  country_id uuid references public.countries (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.statuses (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  group_name text,
  color text,
  created_at timestamptz not null default now()
);

create table if not exists public.supervisors (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.guide_informations (
  id uuid primary key default gen_random_uuid(),
  category text,
  title text not null,
  body text,
  created_at timestamptz not null default now()
);

create table if not exists public.profits (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  percent numeric(6, 2),
  country_id uuid references public.countries (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ready_offers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  country text,
  days int,
  price numeric(12, 2),
  currency text,
  created_at timestamptz not null default now()
);

create table if not exists public.care_tickets (
  id uuid primary key default gen_random_uuid(),
  customer text,
  subject text,
  status text default 'Active',
  note text,
  created_at timestamptz not null default now()
);

create index if not exists airports_country_id_idx on public.airports (country_id);
create index if not exists ports_country_id_idx on public.ports (country_id);
create index if not exists drivers_country_id_idx on public.drivers (country_id);
create index if not exists tours_country_id_idx on public.tours (country_id);
create index if not exists transfers_country_id_idx on public.transfers (country_id);
create index if not exists profits_country_id_idx on public.profits (country_id);

-- RLS: internal tables — authenticated employees have full access.
do $$
declare
  t text;
  tables text[] := array[
    'airports','ports','drivers','tours','transfers','statuses','supervisors',
    'guide_informations','profits','ready_offers','care_tickets'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists authenticated_all on public.%I;', t);
    execute format(
      'create policy authenticated_all on public.%I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;
