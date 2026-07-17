-- App Travluin — "إعادة تصميم بكج مورّد" (repackage a supplier PDF into a Traveliun offer).
--
-- Two new internal-only tables + provenance columns on offers:
--   • suppliers_repackage  — the supplier a package was imported from (name/ref).
--   • repackage_imports    — one row per import/draft; all mutable state (extracted
--     fields, per-field confidence, edits) lives in `data` jsonb (mirrors
--     offer_drafts, 0009). Holds supplier COST → NO anon policy, ever.
--   • offers.source_kind / source_supplier_id / source_import_id — provenance so a
--     re-issued package flows through kanban/reporting and links back for audit.
--
-- offers has an anon public_read policy (0001), so ONLY opaque ids go on offers —
-- never the supplier name/cost (those stay on the authenticated-only tables above).
-- Idempotent; safe to re-run.

-- ── supplier registry (authenticated-only lookup) ─────────────────────────────
create table if not exists public.suppliers_repackage (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists suppliers_repackage_name_key
  on public.suppliers_repackage (lower(name));

alter table public.suppliers_repackage enable row level security;
drop policy if exists authenticated_all on public.suppliers_repackage;
create policy authenticated_all on public.suppliers_repackage
  for all to authenticated using (true) with check (true);

-- ── import drafts (jsonb; internal-only — holds supplier cost) ────────────────
create table if not exists public.repackage_imports (
  id uuid primary key default gen_random_uuid(),
  title text,
  data jsonb not null default '{}'::jsonb,
  -- internal audit only — the original supplier file path in Storage; NEVER shown to clients.
  original_file_path text,
  supplier_id uuid references public.suppliers_repackage (id) on delete set null,
  created_by uuid references public.employees (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists repackage_imports_updated_at_idx
  on public.repackage_imports (updated_at desc);

alter table public.repackage_imports enable row level security;
drop policy if exists authenticated_all on public.repackage_imports;
create policy authenticated_all on public.repackage_imports
  for all to authenticated using (true) with check (true);

-- ── offer provenance (opaque ids only — offers is anon-readable) ──────────────
alter table public.offers add column if not exists source_kind text not null default 'direct';
alter table public.offers add column if not exists source_supplier_id uuid;
alter table public.offers add column if not exists source_import_id uuid;

do $$ begin
  alter table public.offers
    add constraint offers_source_supplier_fk
    foreign key (source_supplier_id) references public.suppliers_repackage (id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.offers
    add constraint offers_source_import_fk
    foreign key (source_import_id) references public.repackage_imports (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ── private storage bucket for original supplier files (internal audit only) ──
-- NOT public (unlike the 'guide' bucket) — the supplier file must never be
-- reachable by a client link; only authenticated staff can read/write it.
insert into storage.buckets (id, name, public)
values ('repackage', 'repackage', false)
on conflict (id) do nothing;

drop policy if exists repackage_rw on storage.objects;
create policy repackage_rw on storage.objects
  for all to authenticated using (bucket_id = 'repackage') with check (bucket_id = 'repackage');
