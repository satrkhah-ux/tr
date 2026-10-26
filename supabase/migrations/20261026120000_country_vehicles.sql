-- 20261026120000 — country_vehicles: a vehicle's capacity IN a country
-- (the owner's transport order, 2026-10-26: «نقل بيانات المواصلات وتنظيم قسم المواصلات»).
--
-- The old system's `cars` table held seats and bags PER (country × vehicle) —
-- 63 rows over 14 countries — and the same «سيارة صغيرة» genuinely differs by
-- country. transportation_types keeps the general answer (pax_capacity /
-- luggage_capacity, filled by the 7th section of the legacy reference import);
-- this table holds the country's own numbers where the old system knew them.
-- Readers fall back: country row first, the type's general figure otherwise.

create table if not exists public.country_vehicles (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references public.countries (id) on delete cascade,
  -- the vehicle as the fleet names it (transportation_types.arabic_name),
  -- exactly like transfers.car_type and tour_prices.car_type
  car_type text not null,
  pax_capacity int,
  luggage_capacity int,
  created_at timestamptz not null default now(),
  unique (country_id, car_type)
);

alter table public.country_vehicles enable row level security;
revoke all on public.country_vehicles from anon;

drop policy if exists country_vehicles_staff_all on public.country_vehicles;
create policy country_vehicles_staff_all on public.country_vehicles
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

comment on table public.country_vehicles is
  'Vehicle capacity per country (legacy `cars`): pax/bags for a car_type in one country; transportation_types holds the general fallback.';
