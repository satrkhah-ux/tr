-- Two small things the hotel popup now stands on.
--
-- 1. app_settings — choices the ADMINISTRATION makes once for everyone, starting
--    with which system the package generator searches for hotels (the internal
--    catalogue or a connected supplier). It used to be a dropdown in front of
--    every agent; the agent's job is to find the hotel by name, not to pick the
--    agency's sourcing policy. Staff read it; only the server writes it, after
--    checking settings.manage.
--
-- 2. hotel_rate_memory.per_night — the remembered price of a room is now PER
--    NIGHT. It used to be the price of whatever stay it was typed for, so a
--    3-night figure was offered to a 5-night stay as if it were the whole. Rows
--    saved before this keep per_night = false and are no longer recalled: their
--    night count was never recorded, so they cannot be converted honestly.

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists app_settings_staff_read on public.app_settings;
create policy app_settings_staff_read
  on public.app_settings for select to authenticated
  using (public.is_staff());

insert into public.app_settings (key, value)
values ('hotel_search_source', 'internal')
on conflict (key) do nothing;

alter table public.hotel_rate_memory add column if not exists per_night boolean not null default false;

notify pgrst, 'reload schema';
