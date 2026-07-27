-- App Travluin — legacy import bookkeeping.
--
-- Maps a row in the OLD systems (imported into the legacy_app / legacy_sys
-- schemas) to the uuid it became here. Kept in its own table rather than as
-- `legacy_id` columns on the business tables so the app schema stays clean —
-- and so the whole import can be re-run: every insert looks here first, which
-- makes the mapping idempotent instead of duplicating on a second pass.
--
-- `source` is which old system the row came from:
--   'app' = tourhawl_traveliun_app (the newer Laravel-era system)
--   'sys' = tourhawl_systraveliun  (the older one)
-- Idempotent; safe to re-run.

create table if not exists public.legacy_id_map (
  entity text not null,
  source text not null check (source in ('app', 'sys')),
  legacy_id bigint not null,
  new_id uuid not null,
  imported_at timestamptz not null default now(),
  primary key (entity, source, legacy_id)
);

create index if not exists legacy_id_map_new_id_idx on public.legacy_id_map (new_id);

alter table public.legacy_id_map enable row level security;

drop policy if exists legacy_id_map_authenticated_all on public.legacy_id_map;
create policy legacy_id_map_authenticated_all
  on public.legacy_id_map
  for all
  to authenticated
  using (true)
  with check (true);

/**
 * Digits-only mobile, with the Saudi country code / trunk zero stripped, so the
 * SAME person entered as "0551234567", "966551234567" and "+966 55 123 4567"
 * in the two old systems collapses to one customer instead of three.
 */
create or replace function public.legacy_norm_mobile(raw text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(regexp_replace(coalesce(raw, ''), '\D', '', 'g'), '^(00966|966|0)', ''),
    ''
  );
$$;
