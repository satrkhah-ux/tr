-- App Travluin — hotel supplier registry + static content cache + audit log.
-- Machine-to-machine supplier credentials are stored ENCRYPTED (AES-256-GCM;
-- see src/lib/crypto/secrets.ts) — never plaintext. Content is cached separately
-- from live rates (rates are never cached). Idempotent; safe to re-run.

-- ---------- hotel_suppliers: the registry (admin-managed) ----------
create table if not exists public.hotel_suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- 'tbo' | 'hotelbeds' | 'agoda'
  name_ar text not null,
  name_en text,
  enabled boolean not null default false,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'live')),
  base_url text,
  -- base64(iv|tag|ciphertext); decryptable only with SETTINGS_ENCRYPTION_KEY (server env).
  credentials_encrypted text,
  priority int not null default 100,         -- lower = queried first
  default_markup_rule_id uuid references public.markup_rules (id) on delete set null,
  last_sync_at timestamptz,
  last_sync_status text,                     -- 'ok' | 'error' | null
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed the TBO row (disabled, no credentials — the admin adds them via Settings).
insert into public.hotel_suppliers (code, name_ar, name_en, enabled, environment, priority)
select 'tbo', 'TBO Holidays', 'TBO Holidays', false, 'sandbox', 10
where not exists (select 1 from public.hotel_suppliers where code = 'tbo');

-- ---------- hotel_content_cache: STATIC content (fetched once, refreshed on a schedule) ----------
create table if not exists public.hotel_content_cache (
  id uuid primary key default gen_random_uuid(),
  supplier text not null,
  supplier_hotel_id text not null,
  internal_hotel_id uuid references public.hotels (id) on delete set null,
  name_ar text,
  name_en text,
  star_rating int,
  address text,
  lat double precision,
  lng double precision,
  description text,
  images jsonb not null default '[]'::jsonb,               -- [{url, order, caption}]
  facilities jsonb not null default '[]'::jsonb,           -- ['pool','spa','gym',...]
  room_type_catalogue jsonb not null default '[]'::jsonb,  -- [{code,name_ar,name_en}]
  check_in_time text,
  check_out_time text,
  content_synced_at timestamptz not null default now(),
  content_source text,
  created_at timestamptz not null default now(),
  unique (supplier, supplier_hotel_id)
);

-- ---------- audit_logs: who changed what, when (NEVER the secret value) ----------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.employees (id) on delete set null,
  actor_email text,
  action text not null,                      -- 'supplier.credentials_changed' etc.
  entity text,
  entity_id text,
  meta jsonb not null default '{}'::jsonb,    -- non-secret context only
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

-- ---------- row-level security ----------
-- All three tables are authenticated-only (never anon). The credential blob is
-- useless without the server-only encryption key, and the data-action layer
-- additionally gates every read/write on the ADMIN role. The public client link
-- reads hotel content from the FROZEN offer snapshot, never from these tables.
do $$
declare t text;
begin
  foreach t in array array['hotel_suppliers', 'hotel_content_cache', 'audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists authenticated_all on public.%I', t);
    execute format('create policy authenticated_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
