-- App Travluin — «أنواع الخدمات» as a real reference table.
--
-- The old system kept a curated list of sellable extras — a SIM card, a VIP
-- fast-track arrival, a floating breakfast, roses in the room — and priced each
-- one PER COUNTRY in its `services` table. Our `public.services` already has
-- the per-country shape (country_id + buy/sell), but the type itself had
-- nowhere to live: `services.service_type` is free text, so every agent spelled
-- the same product differently and «أنواع الخدمات» was served from a static
-- JSON scrape of ten rows.
--
-- So the list becomes a table. `services.service_type_id` points at it while
-- the old free-text column stays beside it — the document and the offer
-- snapshots read the text, and nothing that prints has to learn a join.
--
-- Idempotent; safe to re-run.

create table if not exists public.service_types (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  /**
   * The old system's `customization_flag`: this product is quoted per request
   * rather than from the list price — decorating a specific hotel's rooms, a
   * private car without a driver. Kept because it is the difference between a
   * price an agent may quote and one they must ask about.
   */
  needs_quote boolean not null default false,
  sort int not null default 0,
  status text not null default 'Active',
  created_at timestamptz not null default now()
);

-- The list is short and hand-curated, so the name IS the key. Without this a
-- re-import, or two agents adding «شريحة اتصال» on the same afternoon, quietly
-- doubles the catalogue.
create unique index if not exists service_types_arabic_name_uidx
  on public.service_types (arabic_name);

-- A priced service names its type. `on delete set null`, not cascade: deleting
-- a type from the catalogue must never delete the prices someone quoted from
-- it — the row keeps its `service_type` text and reads as a historical product.
alter table public.services
  add column if not exists service_type_id uuid references public.service_types (id) on delete set null;

create index if not exists services_service_type_id_idx on public.services (service_type_id);

alter table public.service_types enable row level security;

-- Since 0034 a policy written `using (true)` is NOT auto-narrowed, so staff
-- isolation has to be spelled out here.
drop policy if exists service_types_staff_all on public.service_types;
create policy service_types_staff_all
  on public.service_types
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Partner companies read the catalogue they are quoted from, like the other
-- reference lists in 0036.
drop policy if exists service_types_partner_read on public.service_types;
create policy service_types_partner_read
  on public.service_types
  for select
  to authenticated
  using (true);

notify pgrst, 'reload schema';
