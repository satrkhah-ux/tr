-- App Travluin — remember what a room last cost.
--
-- An agent prices «فندق آيوتا تبليسي · استاندر · إفطار» at 500 SAR, and the
-- next file that books the same room starts from an empty box. The number is
-- retyped from memory or from scrolling an old offer, and the two drift.
--
-- The system did have a kind of memory — searchInternalHotels reconstructs a
-- last price from `offer_hotels` — but only from offers that were PRODUCED. A
-- draft that was quoted and never sold, which is most of them, taught it
-- nothing. And it answers per hotel, not per room type, so a suite and a
-- standard room came back with the same figure.
--
-- So: one row per (hotel, room type, board), overwritten each time the agent
-- presses save. Not a rate card — there are no dates and no seasons here, and
-- it is never applied to a document on its own. It is the last answer a human
-- gave to this exact question, offered back as a starting point.
--
-- Idempotent; safe to re-run.

create table if not exists public.hotel_rate_memory (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels (id) on delete cascade,
  /**
   * The room as the agent names it, not an FK: room_types rows belong to one
   * hotel, and the generator works in names throughout — the same «استاندر»
   * spans the whole catalogue.
   */
  room_type_name text not null,
  /** RO/BB/HB/FB/AI, or null when the stay does not state one. */
  board_type text,
  price numeric(12, 2) not null,
  currency text not null default 'SAR',
  updated_by uuid references public.employees (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One memory per product. `coalesce` because a NULL board would otherwise never
-- collide with itself, and the same room would accumulate a row per save.
create unique index if not exists hotel_rate_memory_product_uidx
  on public.hotel_rate_memory (hotel_id, room_type_name, coalesce(board_type, ''));

create index if not exists hotel_rate_memory_hotel_idx on public.hotel_rate_memory (hotel_id);

alter table public.hotel_rate_memory enable row level security;

-- Staff only, and deliberately so: this is what WE pay and charge, and 0034
-- stopped auto-narrowing `using (true)`, so it is spelled out. No partner
-- policy — a partner reads the price on their offer, not our working notes.
drop policy if exists hotel_rate_memory_staff_all on public.hotel_rate_memory;
create policy hotel_rate_memory_staff_all
  on public.hotel_rate_memory
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

notify pgrst, 'reload schema';
