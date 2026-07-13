-- App Travluin — package-generator drafts.
-- One row per in-progress offer draft. Each stage of /package-generator/[draftId]/*
-- auto-saves its slice into `data` (jsonb), so work is resumable from any URL.
-- Internal-only: drafts can contain buy pricing → NO anon policy, ever.
-- Idempotent; safe to re-run.

create table if not exists public.offer_drafts (
  id uuid primary key default gen_random_uuid(),
  title text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references public.employees (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists offer_drafts_updated_at_idx on public.offer_drafts (updated_at desc);

alter table public.offer_drafts enable row level security;
drop policy if exists authenticated_all on public.offer_drafts;
create policy authenticated_all on public.offer_drafts
  for all to authenticated using (true) with check (true);
