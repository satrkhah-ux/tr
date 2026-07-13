-- App Travluin — client-safe hotel CONTENT on offer hotel lines. These come from
-- the static content cache (image, facilities, stars) at selection time and are
-- frozen into the render snapshot. They are CLIENT-SAFE (the client PDF shows the
-- image + facilities) — unlike the supplier/net/rate_key fields (0014) which are
-- structurally stripped from ClientOfferDTO. Idempotent.

alter table public.offer_hotels
  add column if not exists image_url text,
  add column if not exists facilities jsonb not null default '[]'::jsonb,
  add column if not exists content_star_rating int,
  -- the RATE's room name (supplier-sourced hotels have no internal room_type_id)
  add column if not exists room_type_name text;
