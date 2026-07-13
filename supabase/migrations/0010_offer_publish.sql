-- App Travluin — offer publishing + versioned client renders.
-- Adds an audit trail of offer status changes, lets the PUBLIC client link read
-- the published (already-redacted) client snapshot, and guards render versions.
-- Idempotent; safe to re-run.

-- ---------- offer_status_history (NEW): audit trail of status transitions ----------
create table if not exists public.offer_status_history (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists offer_status_history_offer_id_idx on public.offer_status_history (offer_id);

-- One row per (offer, variant, version) — publishing computes the next version.
create unique index if not exists offer_renders_offer_variant_version_uidx
  on public.offer_renders (offer_id, variant, version);

-- ---------- row-level security ----------
do $$ begin
  -- audit trail: authenticated only.
  execute 'alter table public.offer_status_history enable row level security';
  execute 'drop policy if exists authenticated_all on public.offer_status_history';
  execute 'create policy authenticated_all on public.offer_status_history for all to authenticated using (true) with check (true)';

  -- The PUBLIC /client-offer link (anon key) must serve the LATEST PUBLISHED
  -- client snapshot. offer_renders is otherwise authenticated-only; grant anon
  -- SELECT for variant='client' ONLY. Client snapshots are the ClientOfferDTO,
  -- which is structurally stripped of buy_price / profit / margin (dto.ts), so
  -- this exposes nothing an offer's own serial-holder can't already see.
  -- Internal renders stay hidden from anon.
  execute 'drop policy if exists public_read_client on public.offer_renders';
  execute 'create policy public_read_client on public.offer_renders for select to anon using (variant = ''client'')';
end $$;
