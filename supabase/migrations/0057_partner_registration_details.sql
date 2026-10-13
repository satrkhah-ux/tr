-- A registration a tourism company can actually be approved on (partner order 5).
--
-- What a request carries beyond who-and-how-to-reach-them: the commercial
-- register, the tourism licence, the VAT number, where it operates, its
-- documents, and the moment it accepted our terms (and which version). A
-- reference number answers «what happened to my request» without an id.
--
-- Additive only: every column is nullable or defaulted, so a company approved
-- before this migration is untouched.

alter table public.booking_partners
  add column if not exists commercial_register text,
  add column if not exists tourism_license text,
  add column if not exists vat_number text,
  add column if not exists city text,
  add column if not exists country text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists reference_no text,
  -- [{ kind: 'commercial_register'|'tourism_license'|'vat', path, name, size, type }]
  add column if not exists documents jsonb not null default '[]'::jsonb;

create unique index if not exists booking_partners_reference_no_key
  on public.booking_partners (reference_no)
  where reference_no is not null;

-- The documents: PRIVATE. No storage policy is created on purpose — only the
-- service role writes them (the registration action) and reads them (a staff
-- action that signs a five-minute URL). A public bucket would publish every
-- applicant's commercial register to anyone who guessed a path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'partner-documents',
  'partner-documents',
  false,
  5242880,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
