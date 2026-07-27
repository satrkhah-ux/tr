-- App Travluin — day-by-day program («البرنامج اليومي»).
--
-- One row per printed day. The text is authored by the agent (optionally
-- drafted by the AI and then reviewed); the weather columns hold a REAL reading
-- snapshotted at produce time — `weather_source` records whether it is an
-- actual forecast or a climate average, so the document can never present an
-- average as a forecast.
--
-- Client-safe by construction: no money, no supplier identity, so these rows go
-- straight into the client document like offer_cities/offer_services do.
-- Idempotent; safe to re-run.

create table if not exists public.offer_days (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  day_number integer not null,
  day_date date,
  city_name text not null default '',
  title text not null default '',
  activities text[] not null default '{}',
  temp_max numeric(4, 1),
  temp_min numeric(4, 1),
  rain_chance integer,
  weather_code integer,
  weather_source text check (weather_source in ('forecast', 'normals')),
  weather_fetched_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists offer_days_offer_day_key
  on public.offer_days (offer_id, day_number);

create index if not exists offer_days_offer_id_idx on public.offer_days (offer_id);

alter table public.offer_days enable row level security;

-- Same access shape as the other offer child tables: signed-in staff manage
-- them; the client document reads through the frozen render snapshot, not here.
drop policy if exists offer_days_authenticated_all on public.offer_days;
create policy offer_days_authenticated_all
  on public.offer_days
  for all
  to authenticated
  using (true)
  with check (true);
